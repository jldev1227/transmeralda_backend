const Queue = require('bull');
const { redisOptions } = require('../config/redisClient');
const logger = require('../utils/logger');
const { Vehiculo, Documento } = require('../models');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { uploadProcessedDocuments, saveTemporaryDocument } = require('../controllers/documentoController');
const fs = require('fs').promises;
const { redisClient } = require('../config/redisClient');
const { spawn } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');

/**
 * Notifica a todos los clientes conectados
 * @param {string} evento - Nombre del evento a emitir
 * @param {object} datos - Datos a enviar
 */
function notificarGlobal(evento, datos) {
  if (!global.io) {
    logger.error(`No se puede emitir evento global ${evento}: global.io no inicializado`);
    return;
  }

  try {
    global.io.emit(evento, datos);
    logger.debug(`Evento ${evento} emitido globalmente a todos los clientes conectados`);
  } catch (error) {
    logger.error(`Error al emitir evento global ${evento}: ${error.message}`);
  }
}

// Configuración de las colas
const vehiculoCreacionQueue = new Queue('vehiculo-creacion', {
  redis: {
    host: redisOptions.host,
    port: redisOptions.port,
    password: redisOptions.password,
  },
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
    attempts: 1, // Cambiar a 1 intento para evitar duplicados
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

const vehiculoActualizacionQueue = new Queue('vehiculo-actualizacion', {
  redis: {
    host: redisOptions.host,
    port: redisOptions.port,
    password: redisOptions.password,
  },
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
    attempts: 1, // Cambiar a 1 intento para evitar duplicados
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

async function waitForOcrResult(operationLocation, subscriptionKey) {
  let status = 'running';
  let result;
  let retries = 0;
  const maxRetries = 60; // Máximo de intentos (60 segundos)

  while ((status === 'running' || status === 'notStarted') && retries < maxRetries) {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const response = await axios.get(operationLocation, {
        headers: {
          'Ocp-Apim-Subscription-Key': subscriptionKey
        }
      });

      status = response.data.status;
      if (status === 'succeeded') {
        result = response.data;
        break;
      }
      retries++;
    } catch (error) {
      logger.error(`Error al consultar estado OCR: ${error.message}`);
      retries++;
      if (retries >= maxRetries) {
        throw new Error(`Tiempo de espera agotado para OCR después de ${maxRetries} intentos`);
      }
    }
  }

  if (!result) {
    logger.error(`OCR no completado exitosamente. Estado final: ${status}`);
    throw new Error(`OCR no completado exitosamente. Estado final: ${status}`);
  }

  return result;
}

/**
 * Ejecuta un script Python para procesar datos OCR

 * @param {string|null} placa - Placa del vehículo (opcional)
 * @returns {Promise<object>} - Resultado del procesamiento
 */
async function runOcrScript(filePath, placa = null) {
  return new Promise((resolve, reject) => {
    // Registrar inicio de ejecución
    logger.info(`Ejecutando script ${"ocrTARJETA_DE_PROPIEDAD.py"} para categoría ${"TARJETA_DE_PROPIEDAD"}${placa ? ` con placa ${placa}` : ''}`);

    // Configurar argumentos del script
    // Pasamos el path del archivo como argumento explícito
    const args = [`./src/scripts/ocrTARJETA_DE_PROPIEDAD.py`, `--file=${filePath}`];

    // Si hay placa, la añadimos como argumento adicional
    if (placa) {
      args.push(`--placa=${placa}`);
    }

    logger.debug(`Ejecutando script con argumentos: ${args.join(' ')}`);

    const pythonProcess = spawn('python', args);

    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      logger.error(`Error en script Python (${"TARJETA_DE_PROPIEDAD"}): ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const parsedResult = JSON.parse(stdoutData);
          console.log(parsedResult, "Resultado del script OCR");
          logger.info(`Script ${"ocrTARJETA_DE_PROPIEDAD.py"} ejecutado exitosamente`);
          resolve(parsedResult);
        } catch (error) {
          logger.error(`Error al parsear resultado del script ${"ocrTARJETA_DE_PROPIEDAD.py"}: ${error.message}`);
          reject(new Error(`Error al parsear resultado de script (${"TARJETA_DE_PROPIEDAD"}): ${error.message}. Datos: ${stdoutData.substring(0, 200)}...`));
        }
      } else {
        logger.error(`Script ${"ocrTARJETA_DE_PROPIEDAD.py"} falló con código ${code}. Error: ${stderrData}`);
        reject(new Error(`Script falló con código ${code} (${"TARJETA_DE_PROPIEDAD"}). Error: ${stderrData}`));
      }
    });

    // Manejar errores del proceso
    pythonProcess.on('error', (error) => {
      logger.error(`Error al iniciar script ${"ocrTARJETA_DE_PROPIEDAD.py"}: ${error.message}`);
      reject(new Error(`Error al iniciar script: ${error.message}`));
    });
  });
}

/**
 * Procesa datos OCR con archivo temporal
 * @param {object} ocrData - Datos del OCR
 * @param {string|null} placa - Placa del vehículo (opcional)
 * @returns {Promise<object>} - Resultado del procesamiento
 */
async function procesarConArchivoTemporal(ocrData, placa = null) {
  const uniqueId = uuidv4().substring(0, 8); // Identificador único para evitar colisiones
  const dirPath = path.join(__dirname, '..', '..', 'temp');
  const filePath = path.join(dirPath, `tempOcrData_${"TARJETA_DE_PROPIEDAD"}_${uniqueId}.json`);

  try {
    // Crear directorio si no existe
    await fs.mkdir(dirPath, { recursive: true });

    // Guardar datos OCR en formato JSON
    await fs.writeFile(filePath, JSON.stringify(ocrData, null, 2), 'utf8');
    logger.debug(`Archivo temporal creado: ${filePath}`);

    // Ejecutar script Python
    const resultado = await runOcrScript(filePath, placa);

    // Eliminar archivo temporal después de usarlo
    try {
      // await fs.unlink(filePath);
      logger.debug(`Archivo temporal eliminado: ${filePath}`);
    } catch (unlinkError) {
      logger.warn(`No se pudo eliminar el archivo temporal ${filePath}: ${unlinkError.message}`);
    }

    return resultado;

  } catch (error) {
    // Intentar eliminar el archivo temporal incluso si ocurrió un error
    try {
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      if (fileExists) {
        await fs.unlink(filePath);
        logger.debug(`Archivo temporal eliminado después de error: ${filePath}`);
      }
    } catch (unlinkError) {
      logger.warn(`No se pudo eliminar el archivo temporal en manejo de error: ${unlinkError.message}`);
    }

    logger.error(`Error al procesar archivo temporal para TARJETA_DE_PROPIEDAD: ${error.message}`);
    throw error;
  }
}

// Función para inicializar los procesadores (debe ser llamada al iniciar la app)
function inicializarProcesadores() {
  logger.info('Inicializando procesadores de colas de vehículos...');

  // Procesador para creación de vehículos
  // Procesador para creación de vehículos
  vehiculoCreacionQueue.process('crear-vehiculo', async (job) => {
    const { sessionId, adaptedFiles, datosVehiculo, categorias, socketId } = job.data;

    console.log(job.data, "Datos del vehículo en el procesador");

    try {
      // ✅ Usar hmset para compatibilidad total
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'procesados', '0',
        'totalDocumentos', adaptedFiles.length.toString(),
        'progreso', '0',
        'estado', 'iniciando',
        'mensaje', 'Iniciando procesamiento de documentos...'
      );

      logger.info(`Iniciando procesamiento de creación de vehículo: ${sessionId}`);

      // Notificar inicio del procesamiento
      notificarGlobal('vehiculo:procesamiento:inicio', {
        sessionId,
        socketId,
        tipo: 'creacion',
        estado: 'iniciando',
        mensaje: 'Iniciando procesamiento de documentos...',
        progreso: 0
      });

      // Paso 1: Validar datos del vehículo
      job.progress(10);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '10',
        'mensaje', 'Validando datos del vehículo...'
      );

      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Validando datos del vehículo...',
        progreso: 10
      });

      // Validar documentos obligatorios
      const categoriasObligatorias = ["TARJETA_DE_PROPIEDAD"];
      const categoriasFaltantes = categoriasObligatorias.filter(
        (categoria) => !categorias.includes(categoria)
      );

      if (categoriasFaltantes.length > 0) {
        const errorMsg = `Falta la tarjeta de propiedad, que es obligatoria.`;
        await handleProcessingError(sessionId, socketId, errorMsg, 'validacion_documentos_faltantes');
        throw new Error(errorMsg);
      }

      // Validar que el número de archivos coincida con las categorías
      if (adaptedFiles.length !== categorias.length) {
        const errorMsg = `El número de archivos (${adaptedFiles.length}) no coincide con el número de categorías (${categorias.length})`;
        await handleProcessingError(sessionId, socketId, errorMsg, 'validacion_cantidad_archivos');
        throw new Error(errorMsg);
      }

      // Paso 2: Crear el vehículo
      job.progress(20);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '20',
        'mensaje', 'Creando registro del vehículo...'
      );

      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Creando registro del vehículo...',
        progreso: 20
      });

      // Paso 3: Guardar documentos temporalmente y almacenar en Redis
      job.progress(30);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '30',
        'mensaje', 'Procesando documentos...'
      );

      const totalArchivos = adaptedFiles.length;
      let nuevoVehiculo

      for (let i = 0; i < adaptedFiles.length; i++) {
        const archivo = adaptedFiles[i];

        job.progress(40);

        // ✅ Actualizar progreso detallado en Redis
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'procesados', (i + 1).toString(),
          'progreso', 40,
          'mensaje', `Procesando documento ${archivo.categoria} (${i + 1}/${totalArchivos})...`,
          'documento_actual', archivo.categoria
        );

        notificarGlobal('vehiculo:procesamiento:progreso', {
          sessionId,
          socketId,
          error: '',
          mensaje: `Procesando documento ${archivo.categoria} (${i + 1}/${totalArchivos})...`,
          progreso: 40
        });

        try {
          // ✅ Usar la función existente para guardar temporalmente
          const fileInfo = await saveTemporaryDocument(archivo, sessionId, archivo.categoria);

          logger.info(`Documento temporal guardado: ${archivo.categoria}`, {
            path: fileInfo.path,
            size: fileInfo.size,
            originalname: fileInfo.originalname
          });

          // ✅ Almacenar información en Redis para procesamiento posterior
          await redisClient.set(
            `vehiculo:${sessionId}:files:${archivo.categoria}`,
            JSON.stringify(fileInfo),
            'EX', 3600 // Expira en 1 hora
          );

          // ✅ Marcar documento como procesado usando comandos separados
          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${archivo.categoria}_procesado`, 'true');
          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${archivo.categoria}_size`, fileInfo.size.toString());

          logger.info(`Información del documento ${archivo.categoria} almacenada en Redis`);

          logger.info(`Procesando documento ${archivo.categoria} (${i + 1}/${totalArchivos})...`);
          logger.info(archivo.categoria === "TARJETA_DE_PROPIEDAD" ? "Tarjeta de propiedad detectada, iniciando OCR..." : "Documento no requiere OCR");

          if (archivo.categoria === 'TARJETA_DE_PROPIEDAD') {
            logger.info(`Se iniciará el proceso de OCR para la tarjeta de propiedad`);

            try {
              // Configuración para OCR
              const documentIntelligenceEndpoint = process.env.DOC_INTELLIGENCE;
              const subscriptionKey = process.env.DOC_INTELLIGENCE_KEY;

              // Asegurar que las variables de entorno estén definidas
              if (!documentIntelligenceEndpoint || !subscriptionKey) {
                const errorMsg = 'Variables de entorno para OCR no configuradas correctamente';
                logger.error(errorMsg);
                await handleProcessingError(sessionId, socketId, errorMsg, 'configuracion_ocr');
                throw new Error(errorMsg);
              }

              const form = new FormData();
              form.append(archivo.categoria, Buffer.from(archivo.buffer), {
                filename: archivo.filename,
                contentType: archivo.mimetype,
              });

              let response;
              try {
                response = await axios.post(documentIntelligenceEndpoint, form, {
                  headers: {
                    'Ocp-Apim-Subscription-Key': subscriptionKey,
                    ...form.getHeaders(),
                  },
                  timeout: 30000 // 30 segundos de timeout
                });
              } catch (error) {
                const errorMsg = `Error al enviar documento a OCR: ${error.response?.data?.error || error.message}`;
                logger.error(`Error al enviar a OCR ${archivo.categoria}: ${error.message}`);
                await handleProcessingError(sessionId, socketId, errorMsg, 'ocr_envio');
                throw new Error(errorMsg);
              }

              const operationLocation = response.headers['operation-location'];
              if (!operationLocation) {
                const errorMsg = 'No se recibió operation-location en la respuesta de OCR';
                logger.error(errorMsg);
                await handleProcessingError(sessionId, socketId, errorMsg, 'ocr_operation_location');
                throw new Error(errorMsg);
              }

              // Esperar resultado del OCR con manejo de errores
              logger.info(`Esperando resultado OCR para ${archivo.categoria}. Sesión: ${sessionId}`);
              let ocrData;
              try {
                ocrData = await waitForOcrResult(operationLocation, subscriptionKey);
              } catch (error) {
                const errorMsg = `Error en proceso OCR: ${error.message}`;
                logger.error(`Error al esperar resultado OCR para ${archivo.categoria}: ${error.message}`);
                await handleProcessingError(sessionId, socketId, errorMsg, 'ocr_procesamiento');
                throw new Error(errorMsg);
              }

              // Ejecutar OCR en la tarjeta de propiedad
              job.progress(60); // Incrementar progreso un poco más

              await redisClient.hmset(`vehiculo:${sessionId}`,
                'mensaje', `Procesando OCR de tarjeta de propiedad...`,
                'documento_actual', 'OCR_TARJETA_DE_PROPIEDAD'
              );

              notificarGlobal('vehiculo:procesamiento:progreso', {
                sessionId,
                socketId,
                mensaje: 'Procesando OCR de tarjeta de propiedad...',
                progreso: 60
              });

              // Ejecutar el script OCR
              nuevoVehiculo = await procesarConArchivoTemporal(ocrData);

              // Almacenar datos OCR en Redis para uso posterior
              await redisClient.set(
                `vehiculo:${sessionId}:ocr:TARJETA_DE_PROPIEDAD`,
                JSON.stringify(nuevoVehiculo),
                'EX', 3600 // Expira en 1 hora
              );

              // Verificar si la placa ya existe
              const vehiculoExistente = await Vehiculo.findOne({
                where: { placa: nuevoVehiculo.placa }
              });

              console.log(vehiculoExistente, "Vehículo existente con la placa");
              console.log(nuevoVehiculo)

              if (vehiculoExistente) {
                const errorMsg = `Ya existe un vehículo con la placa ${nuevoVehiculo.placa}`;
                logger.error(errorMsg);
                const processingError = await handleProcessingError(sessionId, socketId, errorMsg, 'validacion_placa_existente');
                throw processingError;
              }

              nuevoVehiculo = await Vehiculo.create({
                ...nuevoVehiculo,
                estado: 'DISPONIBLE'
              });

              logger.info(`Vehículo creado con ID: ${nuevoVehiculo.id}`);

              // Marcar OCR como completado
              await redisClient.hset(`vehiculo:${sessionId}`, 'ocr_tarjeta_completado', 'true');
              await redisClient.hset(`vehiculo:${sessionId}`, 'ocr_tarjeta_data', JSON.stringify(nuevoVehiculo));

            } catch (ocrError) {
              logger.error(`Error en OCR de tarjeta de propiedad: ${ocrError.message}`);

              // Para otros errores de OCR, registrar pero continuar o fallar según criticidad
              await redisClient.hset(`vehiculo:${sessionId}`, 'ocr_tarjeta_error', ocrError.message);

              // El OCR es crítico, fallar el proceso
              await handleProcessingError(sessionId, socketId, `Error en OCR: ${ocrError.message}`, 'ocr_general');
              throw new Error(ocrError.message);
            }
          } else {
            logger.info(`No se requiere OCR para el documento ${archivo.categoria}`);
          }
        } catch (error) {
          logger.error(`Error procesando documento ${archivo.categoria}: ${error.message}`);

          // ✅ Verificar si es error de discrepancia para manejo especial
          if (error.message.includes('DISCREPANCIA DE PLACA DETECTADA')) {
            throw error; // Re-lanzar error de discrepancia sin procesamiento adicional
          }

          // ✅ Manejo de otros errores de documentos
          await handleDocumentError(sessionId, socketId, archivo.categoria, error.message);
          throw new Error(error.message);
        }
      }

      // Paso 4: Subir documentos finales a S3 y crear registros en BD
      job.progress(80);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '80',
        'mensaje', 'Subiendo documentos al almacenamiento en la nube...'
      );

      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Subiendo documentos al almacenamiento en la nube...',
        progreso: 80
      });

      try {

        // ✅ Usar la función existente para subir a S3 y crear registros
        const documentosCreados = await uploadProcessedDocuments(
          sessionId,
          nuevoVehiculo.id,
          datosVehiculo.fechasVigencia,
          false // isUpdate = false porque es creación
        );

        logger.info(`${documentosCreados.length} documentos subidos exitosamente a S3`);

        // Paso 5: Finalizar
        job.progress(100);

        // ✅ Actualizar Redis con resultado final
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'progreso', '100',
          'estado', 'completado',
          'mensaje', 'Vehículo creado exitosamente',
          'documentos_creados', documentosCreados.length.toString(),
          'fecha_completado', new Date().toISOString()
        );

        // ✅ Almacenar información de documentos creados usando comandos separados
        for (const doc of documentosCreados) {
          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${doc.document_type}_s3_key`, doc.s3_key);
          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${doc.document_type}_id`, doc.id);
        }

        notificarGlobal('vehiculo:procesamiento:completado', {
          sessionId,
          socketId,
          tipo: 'creacion',
          vehiculo: nuevoVehiculo,
          documentos: documentosCreados,
          mensaje: 'Vehículo creado exitosamente',
          progreso: 100
        });

        // Notificar globalmente la creación del nuevo vehículo
        notificarGlobal('vehiculo:creado', {
          vehiculo: nuevoVehiculo,
          documentos: documentosCreados
        });

        logger.info(`Creación de vehículo completada: ${sessionId}`);
        return { vehiculo: nuevoVehiculo, documentos: documentosCreados };

      } catch (uploadError) {
        logger.error(`Error subiendo documentos a S3: ${uploadError.message}`);
        await handleProcessingError(sessionId, socketId, `Error al subir documentos: ${uploadError.message}`, 'upload_s3', nuevoVehiculo.id);
        throw new Error(`Error al subir documentos: ${uploadError.message}`);
      }

    } catch (error) {
      logger.error(`Error en procesamiento de creación ${sessionId}: ${error.message}`);

      // ✅ Si no se ha manejado ya el error, manejarlo aquí
      if (!error.message.includes('DISCREPANCIA DE PLACA DETECTADA')) {
        await handleProcessingError(sessionId, socketId, error.message, 'general');
      }

      // Limpiar archivos temporales en caso de error
      try {
        const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);
        await fs.rm(tempDir, { recursive: true, force: true });
        logger.info(`Directorio temporal limpiado`);
      } catch (cleanupError) {
        logger.warn(`Error al limpiar directorio temporal: ${cleanupError.message}`);
      }

      throw error;
    } finally {
      // ✅ Configurar expiración de datos en Redis (opcional)
      await redisClient.expire(`vehiculo:${sessionId}`, 86400); // Expira en 24 horas
    }
  });

  // ✅ Clase de error personalizada para evitar múltiples notificaciones
  class ProcessingError extends Error {
    constructor(message, type, alreadyHandled = false) {
      super(message);
      this.name = 'ProcessingError';
      this.type = type;
      this.alreadyHandled = alreadyHandled;
    }
  }

  // ✅ Función auxiliar para manejo centralizado de errores de procesamiento
  async function handleProcessingError(sessionId, socketId, errorMessage, errorType, vehiculoId = null) {
    try {
      // Actualizar Redis con información detallada del error
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'estado', 'error',
        'error', errorMessage,
        'error_tipo', errorType,
        'mensaje', 'Error al crear el vehículo',
        'fecha_error', new Date().toISOString()
      );

      // Notificar globalmente sobre el error
      notificarGlobal('vehiculo:procesamiento:error', {
        sessionId,
        socketId,
        tipo: 'creacion',
        error: errorMessage,
        errorTipo: errorType,
        mensaje: 'Error al crear el vehículo',
        critico: true
      });

      // Si hay un vehículo creado, eliminarlo
      if (vehiculoId) {
        try {
          await Vehiculo.destroy({ where: { id: vehiculoId } });
          logger.info(`Vehículo con ID ${vehiculoId} eliminado debido a error: ${errorType}`);
        } catch (deleteError) {
          logger.error(`Error al eliminar vehículo ${vehiculoId}: ${deleteError.message}`);
        }
      }

      // Retornar un error marcado como ya manejado
      return new ProcessingError(errorMessage, errorType, true);
    } catch (redisError) {
      logger.error(`Error al actualizar Redis con información de error: ${redisError.message}`);
      return new ProcessingError(errorMessage, errorType, true);
    }
  }

  // ✅ Función auxiliar para manejo específico de errores de documentos
  async function handleDocumentError(sessionId, socketId, categoria, errorMessage, vehiculoId = null) {
    try {
      // ✅ Actualizar Redis con error específico del documento
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'estado', 'error',
        'error', `Error al procesar documento ${categoria}: ${errorMessage}`
      );
      await redisClient.hset(`vehiculo:${sessionId}`, `documento_${categoria}_error`, errorMessage);

      // Notificar error específico del documento
      notificarGlobal('vehiculo:procesamiento:error', {
        sessionId,
        socketId,
        tipo: 'creacion',
        error: `Error al procesar documento ${categoria}: ${errorMessage}`,
        errorTipo: 'documento_procesamiento',
        documento: categoria,
        mensaje: `Error al procesar documento ${categoria}`,
        critico: true
      });

      // Eliminar el vehículo creado si existe
      if (vehiculoId) {
        try {
          await Vehiculo.destroy({ where: { id: vehiculoId } });
          logger.info(`Vehículo con ID ${vehiculoId} eliminado por error en documento ${categoria}`);
        } catch (deleteError) {
          logger.error(`Error al eliminar vehículo: ${deleteError.message}`);
        }
      }

      // Retornar un error marcado como ya manejado
      return new ProcessingError(`Error al procesar documento ${categoria}: ${errorMessage}`, 'documento_procesamiento', true);
    } catch (redisError) {
      logger.error(`Error al actualizar Redis con error de documento: ${redisError.message}`);
      return new ProcessingError(`Error al procesar documento ${categoria}: ${errorMessage}`, 'documento_procesamiento', true);
    }
  }

  // Procesador para actualización de vehículos - REESTRUCTURADO
  vehiculoActualizacionQueue.process('actualizar-vehiculo', async (job) => {
    const { sessionId, adaptedFiles, categorias, fechasVigencia, vehiculoId, socketId, camposBasicos } = job.data;

    try {
      // ✅ Usar hmset para compatibilidad total
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'procesados', '0',
        'totalDocumentos', (adaptedFiles?.length || 0).toString(),
        'progreso', '0',
        'estado', 'procesando',
        'mensaje', 'Iniciando actualización del vehículo...'
      );

      logger.info(`Iniciando procesamiento de actualización de vehículo: ${sessionId}`);

      // Notificar inicio del procesamiento
      notificarGlobal('vehiculo:procesamiento:inicio', {
        sessionId,
        socketId,
        tipo: 'actualizacion',
        vehiculoId,
        mensaje: 'Iniciando actualización del vehículo...',
        progreso: 0
      });

      // Paso 1: Verificar que el vehículo existe
      job.progress(10);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '10',
        'mensaje', 'Verificando vehículo...'
      );

      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Verificando vehículo...',
        progreso: 10
      });

      const vehiculo = await Vehiculo.findByPk(vehiculoId);
      if (!vehiculo) {
        const errorMsg = `No se encontró el vehículo con ID: ${vehiculoId}`;
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'estado', 'error',
          'error', errorMsg
        );
        throw new Error(errorMsg);
      }

      // ✅ Almacenar ID del vehículo en Redis
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'vehiculo_id', vehiculo.id
      );

      // Paso 2: Actualizar campos básicos si se proporcionaron
      if (camposBasicos && Object.keys(camposBasicos).length > 0) {
        job.progress(20);
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'progreso', '20',
          'mensaje', 'Actualizando información básica del vehículo...'
        );

        notificarGlobal('vehiculo:procesamiento:progreso', {
          sessionId,
          socketId,
          mensaje: 'Actualizando información básica del vehículo...',
          progreso: 20
        });

        // Verificar si la placa cambió y ya existe otra con la nueva placa
        if (camposBasicos.placa && camposBasicos.placa !== vehiculo.placa) {
          const vehiculoExistente = await Vehiculo.findOne({
            where: {
              placa: camposBasicos.placa,
              id: { [Op.ne]: vehiculoId } // Excluir el vehículo actual
            }
          });

          if (vehiculoExistente) {
            const errorMsg = `Ya existe otro vehículo con la placa ${camposBasicos.placa}`;
            await redisClient.hmset(`vehiculo:${sessionId}`,
              'estado', 'error',
              'error', errorMsg
            );
            throw new Error(errorMsg);
          }
        }

        // Actualizar campos básicos
        await vehiculo.update(camposBasicos);
        logger.info(`Campos básicos actualizados para vehículo ${vehiculoId}:`, camposBasicos);
      }

      // Si no hay documentos para actualizar, terminar aquí
      if (!adaptedFiles || adaptedFiles.length === 0 || !categorias || categorias.length === 0) {
        job.progress(100);
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'progreso', '100',
          'estado', 'completado',
          'mensaje', 'Vehículo actualizado exitosamente (sin cambios en documentos)',
          'fecha_completado', new Date().toISOString()
        );

        const vehiculoActualizado = await Vehiculo.findByPk(vehiculoId);

        notificarGlobal('vehiculo:procesamiento:completado', {
          sessionId,
          socketId,
          tipo: 'actualizacion',
          vehiculo: vehiculoActualizado,
          documentos: [],
          mensaje: 'Vehículo actualizado exitosamente',
          progreso: 100
        });

        // Notificar globalmente la actualización del vehículo
        notificarGlobal('vehiculo:actualizado', {
          vehiculo: vehiculoActualizado,
          documentosActualizados: [],
          categoriasActualizadas: []
        });

        logger.info(`Actualización de vehículo completada (solo campos básicos): ${sessionId}`);
        return { vehiculo: vehiculoActualizado, documentos: [] };
      }

      // Paso 3: Validar documentos para actualización
      job.progress(30);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '30',
        'mensaje', 'Validando documentos para actualización...'
      );

      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Validando documentos para actualización...',
        progreso: 30
      });

      // Validar que el número de archivos coincida con las categorías
      if (adaptedFiles.length !== categorias.length) {
        const errorMsg = `El número de archivos (${adaptedFiles.length}) no coincide con el número de categorías (${categorias.length})`;
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'estado', 'error',
          'error', errorMsg
        );
        throw new Error(errorMsg);
      }

      // Paso 4: Desactivar documentos anteriores de las categorías que se van a actualizar
      job.progress(40);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '40',
        'mensaje', 'Desactivando documentos anteriores...'
      );

      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Desactivando documentos anteriores...',
        progreso: 40
      });

      await Documento.update(
        {
          estado: 'REEMPLAZADO',
          fechaReemplazo: new Date()
        },
        {
          where: {
            vehiculo_id: vehiculoId,
            categoria: categorias,
            estado: 'vigente'
          }
        }
      );

      logger.info(`Documentos anteriores desactivados para categorías: ${categorias.join(', ')}`);

      // Paso 5: Guardar documentos temporalmente y almacenar en Redis
      job.progress(50);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '50',
        'mensaje', 'Procesando nuevos documentos...'
      );

      const totalArchivos = adaptedFiles.length;

      // ✅ Código principal mejorado para evitar errores en cascada
      for (let i = 0; i < adaptedFiles.length; i++) {
        const archivo = adaptedFiles[i];
        const progreso = 30 + ((i + 1) / totalArchivos) * 50; // De 30% a 80%

        job.progress(progreso);

        // ✅ Actualizar progreso detallado en Redis
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'procesados', (i + 1).toString(),
          'progreso', Math.round(progreso).toString(),
          'mensaje', `Procesando documento ${archivo.categoria} (${i + 1}/${totalArchivos})...`,
          'documento_actual', archivo.categoria
        );

        notificarGlobal('vehiculo:procesamiento:progreso', {
          sessionId,
          socketId,
          mensaje: `Procesando documento ${archivo.categoria} (${i + 1}/${totalArchivos})...`,
          progreso: Math.round(progreso)
        });

        let processingError = null;

        try {
          // ✅ Usar la función existente para guardar temporalmente
          const fileInfo = await saveTemporaryDocument(archivo, sessionId, archivo.categoria);

          logger.info(`Documento temporal guardado: ${archivo.categoria}`, {
            path: fileInfo.path,
            size: fileInfo.size,
            originalname: fileInfo.originalname
          });

          // ✅ Almacenar información en Redis para procesamiento posterior
          await redisClient.set(
            `vehiculo:${sessionId}:files:${archivo.categoria}`,
            JSON.stringify(fileInfo),
            'EX', 3600 // Expira en 1 hora
          );

          // ✅ Marcar documento como procesado
          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${archivo.categoria}_procesado`, 'true');
          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${archivo.categoria}_size`, fileInfo.size.toString());

          logger.info(`Información del documento ${archivo.categoria} almacenada en Redis`);
          logger.info(`Procesando documento ${archivo.categoria} (${i + 1}/${totalArchivos})...`);

          if (archivo.categoria === 'TARJETA_DE_PROPIEDAD') {
            logger.info(`Se iniciará el proceso de OCR para la tarjeta de propiedad`);

            try {
              // Configuración para OCR
              const documentIntelligenceEndpoint = process.env.DOC_INTELLIGENCE;
              const subscriptionKey = process.env.DOC_INTELLIGENCE_KEY;

              // Asegurar que las variables de entorno estén definidas
              if (!documentIntelligenceEndpoint || !subscriptionKey) {
                const errorMsg = 'Variables de entorno para OCR no configuradas correctamente';
                logger.error(errorMsg);
                processingError = await handleProcessingError(sessionId, socketId, errorMsg, 'configuracion_ocr');
                throw processingError;
              }

              const form = new FormData();
              form.append(archivo.categoria, Buffer.from(archivo.buffer), {
                filename: archivo.filename,
                contentType: archivo.mimetype,
              });

              let response;
              try {
                response = await axios.post(documentIntelligenceEndpoint, form, {
                  headers: {
                    'Ocp-Apim-Subscription-Key': subscriptionKey,
                    ...form.getHeaders(),
                  },
                  timeout: 30000 // 30 segundos de timeout
                });
              } catch (error) {
                const errorMsg = `Error al enviar documento a OCR: ${error.response?.data?.error || error.message}`;
                logger.error(`Error al enviar a OCR ${archivo.categoria}: ${error.message}`);
                processingError = await handleProcessingError(sessionId, socketId, errorMsg, 'ocr_envio');
                throw processingError;
              }

              const operationLocation = response.headers['operation-location'];
              if (!operationLocation) {
                const errorMsg = 'No se recibió operation-location en la respuesta de OCR';
                logger.error(errorMsg);
                processingError = await handleProcessingError(sessionId, socketId, errorMsg, 'ocr_operation_location');
                throw processingError;
              }

              // Esperar resultado del OCR
              logger.info(`Esperando resultado OCR para ${archivo.categoria}. Sesión: ${sessionId}`);
              let ocrData;
              try {
                ocrData = await waitForOcrResult(operationLocation, subscriptionKey);
              } catch (error) {
                const errorMsg = `Error en proceso OCR: ${error.message}`;
                logger.error(`Error al esperar resultado OCR para ${archivo.categoria}: ${error.message}`);
                processingError = await handleProcessingError(sessionId, socketId, errorMsg, 'ocr_procesamiento');
                throw processingError;
              }

              // Actualizar progreso para OCR
              job.progress(progreso + 5);
              await redisClient.hmset(`vehiculo:${sessionId}`,
                'mensaje', `Procesando OCR de tarjeta de propiedad...`,
                'documento_actual', 'OCR_TARJETA_DE_PROPIEDAD'
              );

              notificarGlobal('vehiculo:procesamiento:progreso', {
                sessionId,
                socketId,
                mensaje: 'Procesando OCR de tarjeta de propiedad...',
                progreso: Math.round(progreso + 5)
              });

              // Ejecutar el script OCR
              nuevoVehiculo = await procesarConArchivoTemporal(ocrData, datosVehiculo.placa);

              // Almacenar datos OCR en Redis
              await redisClient.set(
                `vehiculo:${sessionId}:ocr:TARJETA_DE_PROPIEDAD`,
                JSON.stringify(nuevoVehiculo),
                'EX', 3600
              );

              // ✅ PUNTO CRÍTICO: Verificar placa duplicada ANTES de crear
              try {
                const vehiculoExistente = await Vehiculo.findOne({
                  where: { placa: nuevoVehiculo.placa }
                });

                if (vehiculoExistente) {
                  const errorMsg = `Ya existe un vehículo con la placa ${nuevoVehiculo.placa}`;
                  logger.error(errorMsg);
                  processingError = await handleProcessingError(sessionId, socketId, errorMsg, 'validacion_placa_existente');
                  throw processingError;
                }

                // Crear el vehículo solo si no existe
                nuevoVehiculo = await Vehiculo.create({
                  ...nuevoVehiculo,
                  estado: 'DISPONIBLE'
                });

                logger.info(`Vehículo creado exitosamente con ID: ${nuevoVehiculo.id}`);

                // Marcar OCR como completado
                await redisClient.hset(`vehiculo:${sessionId}`, 'ocr_tarjeta_completado', 'true');
                await redisClient.hset(`vehiculo:${sessionId}`, 'ocr_tarjeta_data', JSON.stringify(nuevoVehiculo));

              } catch (dbError) {
                // ✅ Manejo específico de errores de base de datos
                if (dbError instanceof ProcessingError && dbError.alreadyHandled) {
                  throw dbError; // Re-lanzar si ya fue manejado
                }

                const errorMsg = `Error de validación en base de datos: ${dbError.message}`;
                logger.error(errorMsg);
                processingError = await handleProcessingError(sessionId, socketId, errorMsg, 'validacion_bd');
                throw processingError;
              }

            } catch (ocrError) {
              // ✅ Solo manejar si no ha sido manejado previamente
              if (ocrError instanceof ProcessingError && ocrError.alreadyHandled) {
                throw ocrError; // Re-lanzar sin procesar de nuevo
              }

              logger.error(`Error en OCR de tarjeta de propiedad: ${ocrError.message}`);
              processingError = await handleProcessingError(sessionId, socketId,
                `Error en OCR: ${ocrError.message}`, 'ocr_general', nuevoVehiculo?.id);
              throw processingError;
            }
          } else {
            logger.info(`No se requiere OCR para el documento ${archivo.categoria}`);
          }

        } catch (error) {
          // ✅ Solo manejar errores que no han sido manejados previamente
          if (error instanceof ProcessingError && error.alreadyHandled) {
            throw error; // Re-lanzar sin procesar
          }

          logger.error(`Error procesando documento ${archivo.categoria}: ${error.message}`);
          processingError = await handleDocumentError(sessionId, socketId, archivo.categoria, error.message, nuevoVehiculo?.id);
          throw processingError;
        }
      }

      // Paso 6: Subir documentos finales a S3 y crear registros en BD
      job.progress(80);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '80',
        'mensaje', 'Subiendo documentos al almacenamiento en la nube...'
      );

      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Subiendo documentos al almacenamiento en la nube...',
        progreso: 80
      });

      try {
        // ✅ Usar la función existente para subir a S3 y crear registros
        const documentosCreados = await uploadProcessedDocuments(
          sessionId,
          vehiculoId,
          fechasVigencia,
          true, // isUpdate = true porque es actualización,
          categorias
        );

        logger.info(`${documentosCreados.length} documentos subidos exitosamente a S3`);

        // Paso 7: Actualizar fechas de vigencia en el vehículo
        job.progress(95);
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'progreso', '95',
          'mensaje', 'Actualizando fechas de vigencia...'
        );

        notificarGlobal('vehiculo:procesamiento:progreso', {
          sessionId,
          socketId,
          mensaje: 'Actualizando fechas de vigencia...',
          progreso: 95
        });

        if (fechasVigencia && Object.keys(fechasVigencia).length > 0) {
          // Actualizar campos específicos de fechas de vigencia
          const updateFields = {};
          Object.keys(fechasVigencia).forEach(categoria => {
            const campo = `${categoria.toLowerCase()}_vencimiento`;
            updateFields[campo] = new Date(fechasVigencia[categoria]);
          });

          await vehiculo.update(updateFields);
          logger.info(`Fechas de vigencia actualizadas para vehículo ${vehiculoId}:`, updateFields);
        }

        // Paso 8: Finalizar
        job.progress(100);

        // ✅ Actualizar Redis con resultado final
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'progreso', '100',
          'estado', 'completado',
          'mensaje', 'Vehículo actualizado exitosamente',
          'documentos_creados', documentosCreados.length.toString(),
          'fecha_completado', new Date().toISOString()
        );

        // ✅ Almacenar información de documentos creados usando comandos separados
        for (const doc of documentosCreados) {
          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${doc.document_type}_s3_key`, doc.s3_key);
          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${doc.document_type}_id`, doc.id);
        }

        const vehiculoActualizado = await Vehiculo.findByPk(vehiculoId);

        notificarGlobal('vehiculo:procesamiento:completado', {
          sessionId,
          socketId,
          tipo: 'actualizacion',
          vehiculo: vehiculoActualizado,
          documentos: documentosCreados,
          mensaje: 'Vehículo actualizado exitosamente',
          progreso: 100
        });

        // Notificar globalmente la actualización del vehículo
        notificarGlobal('vehiculo:actualizado', {
          vehiculo: vehiculoActualizado,
          documentosActualizados: documentosCreados,
          categoriasActualizadas: categorias
        });

        logger.info(`Actualización de vehículo completada: ${sessionId}`);
        return { vehiculo: vehiculoActualizado, documentos: documentosCreados };

      } catch (uploadError) {
        logger.error(`Error subiendo documentos a S3: ${uploadError.message}`);

        // ✅ Actualizar Redis con error de subida
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'estado', 'error',
          'error', `Error al subir documentos: ${uploadError.message}`,
          'error_tipo', 'upload_s3'
        );

        throw new Error(`Error al subir documentos: ${uploadError.message}`);
      }

    } catch (error) {
      logger.error(`Error en procesamiento de actualización ${sessionId}: ${error.message}`);

      // ✅ Actualizar Redis con error general
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'estado', 'error',
        'error', error.message,
        'mensaje', 'Error al actualizar el vehículo',
        'fecha_error', new Date().toISOString()
      );

      notificarGlobal('vehiculo:procesamiento:error', {
        sessionId,
        socketId,
        tipo: 'actualizacion',
        vehiculoId,
        error: error.message,
        mensaje: 'Error al actualizar el vehículo'
      });

      // Limpiar archivos temporales en caso de error
      try {
        // const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);
        // await fs.rm(tempDir, { recursive: true, force: true });
        logger.info(`Directorio temporal limpiado: ${tempDir}`);
      } catch (cleanupError) {
        logger.warn(`Error al limpiar directorio temporal: ${cleanupError.message}`);
      }

      throw error;
    } finally {
      // ✅ Configurar expiración de datos en Redis (opcional)
      await redisClient.expire(`vehiculo:${sessionId}`, 86400); // Expira en 2
    }
  })

  // Eventos de monitoreo para creación
  vehiculoCreacionQueue.on('completed', (job, result) => {
    logger.info(`Job de creación completado: ${job.id}`);
  });

  vehiculoCreacionQueue.on('failed', (job, err) => {
    logger.error(`Job de creación falló: ${job.id} - ${err.message}`);
  });

  vehiculoCreacionQueue.on('stalled', (job) => {
    logger.warn(`Job de creación estancado: ${job.id}`);
  });

  // Eventos de monitoreo para actualización
  vehiculoActualizacionQueue.on('completed', (job, result) => {
    logger.info(`Job de actualización completado: ${job.id}`);
  });

  vehiculoActualizacionQueue.on('failed', (job, err) => {
    logger.error(`Job de actualización falló: ${job.id} - ${err.message}`);
  });

  vehiculoActualizacionQueue.on('stalled', (job) => {
    logger.warn(`Job de actualización estancado: ${job.id}`);
  });

  logger.info('Procesadores de colas de vehículos inicializados correctamente');
}

// Función para procesar documentos (creación)
async function procesarDocumentos(adaptedFiles, categorias, datosVehiculo, socketId) {
  const sessionId = uuidv4();

  const jobData = {
    sessionId,
    adaptedFiles,
    categorias,
    datosVehiculo,
    socketId,
    timestamp: new Date().toISOString()
  };

  try {
    await vehiculoCreacionQueue.add('crear-vehiculo', jobData, {
      jobId: sessionId,
      priority: 10
    });

    logger.info(`Job de creación de vehículo encolado: ${sessionId}`);
    return sessionId;
  } catch (error) {
    logger.error(`Error al encolar job de creación: ${error.message}`);
    throw error;
  }
}

// Función para actualizar documentos de vehículo
async function actualizarDocumentosVehiculo(adaptedFiles, categorias, fechasVigencia, vehiculoId, socketId) {
  const sessionId = uuidv4();

  const jobData = {
    sessionId,
    adaptedFiles,
    categorias,
    fechasVigencia,
    vehiculoId,
    socketId,
    timestamp: new Date().toISOString()
  };

  try {
    await vehiculoActualizacionQueue.add('actualizar-vehiculo', jobData, {
      jobId: sessionId,
      priority: 10
    });

    logger.info(`Job de actualización de vehículo encolado: ${sessionId}`);
    return sessionId;
  } catch (error) {
    logger.error(`Error al encolar job de actualización: ${error.message}`);
    throw error;
  }
}

module.exports = {
  vehiculoCreacionQueue,
  vehiculoActualizacionQueue,
  procesarDocumentos,
  actualizarDocumentosVehiculo,
  inicializarProcesadores
};