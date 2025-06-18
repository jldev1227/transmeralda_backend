const Queue = require('bull');
const { redisOptions } = require('../config/redisClient');
const logger = require('../utils/logger');
const { User, Vehiculo, Documento } = require('../models');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { uploadProcessedDocuments, saveTemporaryDocument } = require('../controllers/documentoController');
const fs = require('fs').promises;
const { redisClient } = require('../config/redisClient');
const { spawn } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const eventEmitter = require('../utils/eventEmitter');

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

function notifyUser(userId, event, data) {
  try {
    // Obtener la función notifyUser de la aplicación global
    const notifyFn = global.app?.get("notifyUser");

    if (notifyFn) {
      notifyFn(userId, event, data);
    } else {
      console.log(
        `No se pudo notificar al usuario ${userId} (evento: ${event}) - Socket.IO no está disponible`
      );
    }
  } catch (error) {
    console.error("Error al notificar al usuario:", error);
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
      await fs.unlink(filePath);
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
  vehiculoCreacionQueue.process('crear-vehiculo', async (job) => {
    const { sessionId, adaptedFiles, datosVehiculo, categorias, socketId } = job.data;
    const userId = job.opts.userId;

    try {
      // ====== PASO 1: RECIBO LOS DOCUMENTOS ======
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'procesados', '0',
        'totalDocumentos', adaptedFiles.length.toString(),
        'progreso', '0',
        'estado', 'recibiendo_documentos',
        'mensaje', 'Recibiendo documentos...'
      );

      logger.info(`Iniciando procesamiento de creación de vehículo: ${sessionId}`);

      notifyUser(userId, 'vehiculo:procesamiento:inicio', {
        sessionId,
        socketId,
        tipo: 'creacion',
        estado: 'recibiendo_documentos',
        mensaje: 'Recibiendo documentos...',
        progreso: 0
      });

      // Validar documentos obligatorios
      const categoriasObligatorias = ["TARJETA_DE_PROPIEDAD"];
      const categoriasFaltantes = categoriasObligatorias.filter(
        (categoria) => !categorias.includes(categoria)
      );

      if (categoriasFaltantes.length > 0) {
        const errorMsg = `Falta la tarjeta de propiedad, que es obligatoria.`;
        await handleProcessingError(userId, sessionId, socketId, errorMsg, 'validacion_documentos_faltantes');
        throw new Error(errorMsg);
      }

      if (adaptedFiles.length !== categorias.length) {
        const errorMsg = `El número de archivos (${adaptedFiles.length}) no coincide con el número de categorías (${categorias.length})`;
        await handleProcessingError(userId, sessionId, socketId, errorMsg, 'validacion_cantidad_archivos');
        throw new Error(errorMsg);
      }

      // ====== PASO 2: PROCESO LOS DOCUMENTOS ======
      job.progress(20);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '20',
        'estado', 'procesando_documentos',
        'mensaje', 'Procesando documentos...'
      );

      notifyUser(userId, 'vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Procesando documentos...',
        progreso: 20
      });

      const totalArchivos = adaptedFiles.length;
      let datosExtraidos = null;

      // Procesar cada documento y guardar temporalmente
      for (let i = 0; i < adaptedFiles.length; i++) {
        const archivo = adaptedFiles[i];

        await redisClient.hmset(`vehiculo:${sessionId}`,
          'procesados', (i + 1).toString(),
          'progreso', '30',
          'mensaje', `Procesando documento ${archivo.categoria} (${i + 1}/${totalArchivos})...`,
          'documento_actual', archivo.categoria
        );

        notifyUser(userId, 'vehiculo:procesamiento:progreso', {
          sessionId,
          socketId,
          mensaje: `Procesando documento ${archivo.categoria} (${i + 1}/${totalArchivos})...`,
          progreso: 30
        });

        try {
          // Guardar documento temporalmente
          const fileInfo = await saveTemporaryDocument(archivo, sessionId, archivo.categoria);

          await redisClient.set(
            `vehiculo:${sessionId}:files:${archivo.categoria}`,
            JSON.stringify(fileInfo),
            'EX', 3600
          );

          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${archivo.categoria}_procesado`, 'true');
          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${archivo.categoria}_size`, fileInfo.size.toString());

          logger.info(`Documento ${archivo.categoria} procesado y guardado temporalmente`);

          // Procesar OCR solo para tarjeta de propiedad
          if (archivo.categoria === 'TARJETA_DE_PROPIEDAD') {
            job.progress(50);
            await redisClient.hmset(`vehiculo:${sessionId}`,
              'progreso', '50',
              'mensaje', 'Extrayendo datos de la tarjeta de propiedad...',
              'documento_actual', 'OCR_TARJETA_DE_PROPIEDAD'
            );

            notifyUser(userId, 'vehiculo:procesamiento:progreso', {
              sessionId,
              socketId,
              mensaje: 'Extrayendo datos de la tarjeta de propiedad...',
              progreso: 50
            });

            // Ejecutar OCR
            datosExtraidos = await ejecutarOCRTarjetaPropiedad(archivo, sessionId, socketId);

            // Almacenar datos extraídos en Redis
            await redisClient.set(
              `vehiculo:${sessionId}:ocr:TARJETA_DE_PROPIEDAD`,
              JSON.stringify(datosExtraidos),
              'EX', 3600
            );

            logger.info(`OCR completado para tarjeta de propiedad. Datos extraídos:`, datosExtraidos);
          }

        } catch (error) {
          logger.error(`Error procesando documento ${archivo.categoria}: ${error.message}`);
          await handleDocumentError(userId, sessionId, socketId, archivo.categoria, error.message);
          throw new Error(error.message);
        }
      }

      // ====== PASO 3: VALIDO LOS VALORES EXTRAÍDOS ======
      if (!datosExtraidos) {
        const errorMsg = 'No se pudieron extraer datos de la tarjeta de propiedad';
        await handleProcessingError(userId, sessionId, socketId, errorMsg, 'ocr_sin_datos');
        throw new Error(errorMsg);
      }

      job.progress(60);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '60',
        'estado', 'validando_datos',
        'mensaje', 'Validando datos extraídos...'
      );

      notifyUser(userId, 'vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Validando datos extraídos...',
        progreso: 60
      });

      // Validar campos obligatorios
      const camposObligatorios = ['placa', 'marca'];
      const camposFaltantes = camposObligatorios.filter(campo => !datosExtraidos[campo] || datosExtraidos[campo].trim() === '');

      if (camposFaltantes.length > 0) {
        const errorMsg = `Faltan los siguientes campos obligatorios: ${camposFaltantes.join(', ')}`;
        await handleProcessingError(userId, sessionId, socketId, errorMsg, 'validacion_campos_obligatorios');
        throw new Error(errorMsg);
      }

      // ====== PASO 4: CONFIRMO EXISTENCIAS DE DUPLICIDAD ======
      job.progress(70);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '70',
        'estado', 'verificando_duplicados',
        'mensaje', 'Verificando duplicados...'
      );

      notifyUser(userId, 'vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Verificando duplicados...',
        progreso: 70
      });

      const vehiculoExistente = await Vehiculo.findOne({
        where: { placa: datosExtraidos.placa }
      });

      if (vehiculoExistente) {
        const errorMsg = `Ya existe un vehículo con la placa ${datosExtraidos.placa}`;
        logger.error(errorMsg);
        await handleProcessingError(userId, sessionId, socketId, errorMsg, 'validacion_placa_existente', vehiculoExistente);
        throw new Error(errorMsg);
      }

      // ====== PASO 5: ENVÍO DATOS AL CLIENTE Y ESPERO CONFIRMACIÓN ======
      job.progress(80);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '80',
        'estado', 'esperando_confirmacion',
        'mensaje', 'OCR completado. Esperando confirmación del usuario...',
        'esperando_confirmacion', 'true'
      );

      // Enviar ÚNICAMENTE los datos de la tarjeta de propiedad
      notifyUser(userId, 'vehiculo:confirmacion:requerida', {
        sessionId,
        socketId,
        mensaje: 'Datos extraídos de la tarjeta de propiedad. Por favor confirme la información',
        progreso: 80,
        datosVehiculo: datosExtraidos,
        camposEditables: [
          'propietario_nombre',
          'propietario_identificacion',
          'modelo',
          'linea',
          'fecha_matricula'
        ],
        opciones: {
          confirmar: true,
          editar: true,
          cancelar: true
        }
      });

      logger.info(`Esperando confirmación del usuario para el vehículo con placa: ${datosExtraidos.placa}`);


      // Esperar respuesta del usuario
      const confirmacion = await esperarConfirmacionUsuario(sessionId, socketId);

      // ====== PASO 6: PROCESAR RESPUESTA DEL USUARIO ======
      let datosFinales = { ...datosExtraidos, ...confirmacion.datosModificados };

      if (confirmacion.accion === 'cancelar') {
        logger.info(`Usuario canceló el registro del vehículo con placa: ${datosExtraidos.placa}`);

        await redisClient.del(`vehiculo:${sessionId}:ocr:TARJETA_DE_PROPIEDAD`);

        notifyUser(userId, 'vehiculo:procesamiento:cancelado', {
          sessionId,
          socketId,
          mensaje: 'Registro de vehículo cancelado por el usuario'
        });

        throw new Error('Registro cancelado por el usuario');
      }

      if (confirmacion.accion === 'editar') {
        logger.info(`Usuario solicitó editar los datos del vehículo con placa: ${datosExtraidos.placa}`);

        // Validar campos obligatorios después de edición
        const camposObligatoriosEditados = ['propietario_nombre', 'propietario_identificacion', 'modelo', 'linea', 'fecha_matricula'];
        const camposFaltantesEditados = camposObligatoriosEditados.filter(
          campo => !datosFinales[campo] || datosFinales[campo].trim() === ''
        );

        if (camposFaltantesEditados.length > 0) {
          const errorMsg = `Los siguientes campos obligatorios no pueden estar vacíos: ${camposFaltantesEditados.join(', ')}`;
          await handleProcessingError(userId, sessionId, socketId, errorMsg, 'validacion_campos_editados_obligatorios');
          throw new Error(errorMsg);
        }

        logger.info(`Datos actualizados por el usuario:`, datosFinales);
      }

      // ====== PASO 7: CREAR VEHÍCULO Y SUBIR DOCUMENTOS ======
      job.progress(90);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '90',
        'estado', 'creando_vehiculo',
        'mensaje', 'Creando vehículo en la base de datos...',
        'esperando_confirmacion', 'false'
      );

      notifyUser(userId, 'vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Creando vehículo en la base de datos...',
        progreso: 90
      });

      // Crear el vehículo en la base de datos
      const nuevoVehiculo = await Vehiculo.create({
        ...datosFinales,
        estado: 'DISPONIBLE'
      });

      logger.info(`Vehículo creado con ID: ${nuevoVehiculo.id} y placa: ${nuevoVehiculo.placa}`);

      // Actualizar datos en Redis
      await redisClient.hset(`vehiculo:${sessionId}`, 'vehiculo_id', nuevoVehiculo.id.toString());
      await redisClient.hset(`vehiculo:${sessionId}`, 'ocr_tarjeta_completado', 'true');
      await redisClient.hset(`vehiculo:${sessionId}`, 'ocr_tarjeta_data', JSON.stringify(nuevoVehiculo));

      // Subir documentos a S3 y crear registros
      job.progress(95);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '95',
        'mensaje', 'Subiendo documentos al almacenamiento...'
      );

      notifyUser(userId, 'vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Subiendo documentos al almacenamiento...',
        progreso: 95
      });

      const documentosCreados = await uploadProcessedDocuments(
        sessionId,
        nuevoVehiculo.id,
        datosVehiculo.fechasVigencia,
        false // isUpdate = false porque es creación
      );

      logger.info(`${documentosCreados.length} documentos subidos exitosamente a S3`);

      // ====== FINALIZACIÓN ======
      job.progress(100);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '100',
        'estado', 'completado',
        'mensaje', 'Vehículo registrado exitosamente',
        'documentos_creados', documentosCreados.length.toString(),
        'fecha_completado', new Date().toISOString()
      );

      // Almacenar información de documentos creados
      for (const doc of documentosCreados) {
        await redisClient.hset(`vehiculo:${sessionId}`, `documento_${doc.document_type}_s3_key`, doc.s3_key);
        await redisClient.hset(`vehiculo:${sessionId}`, `documento_${doc.document_type}_id`, doc.id);
      }

      notifyUser(userId, 'vehiculo:procesamiento:completado', {
        sessionId,
        socketId,
        tipo: 'creacion',
        vehiculo: nuevoVehiculo,
        documentos: documentosCreados,
        mensaje: 'Vehículo registrado exitosamente',
        progreso: 100
      });

      notifyUser(userId, 'vehiculo:creado', {
        vehiculo: nuevoVehiculo,
        documentos: documentosCreados
      });

      const { id, nombre } = await User.findByPk(userId);

      notificarGlobal('vehiculo:creado-global', {
        usuarioId: id,
        usuarioNombre: nombre,
        vehiculo: nuevoVehiculo,
        documentos: documentosCreados
      });

      logger.info(`Creación de vehículo completada exitosamente: ${sessionId}`);
      return { vehiculo: nuevoVehiculo, documentos: documentosCreados };

    } catch (error) {
      logger.error(`Error en procesamiento de creación ${sessionId}: ${error.message}`);

      if (!error.message.includes('DISCREPANCIA DE PLACA DETECTADA') &&
        !error.message.includes('Registro cancelado por el usuario')) {
        await handleProcessingError(userId, sessionId, socketId, error.message, 'general');
      }

      // Limpiar archivos temporales
      try {
        const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);
        await fs.rm(tempDir, { recursive: true, force: true });
        logger.info(`Directorio temporal limpiado para sesión ${sessionId}`);
      } catch (cleanupError) {
        logger.warn(`Error al limpiar directorio temporal: ${cleanupError.message}`);
      }

      throw error;
    } finally {
      await redisClient.expire(`vehiculo:${sessionId}`, 86400); // Expira en 24 horas
    }
  });

  // ====== FUNCIONES AUXILIARES ======

  // Función para ejecutar OCR de tarjeta de propiedad
  async function ejecutarOCRTarjetaPropiedad(archivo, sessionId, socketId) {
    try {
      // Configuración para OCR
      const documentIntelligenceEndpoint = process.env.DOC_INTELLIGENCE;
      const subscriptionKey = process.env.DOC_INTELLIGENCE_KEY;

      if (!documentIntelligenceEndpoint || !subscriptionKey) {
        throw new Error('Variables de entorno para OCR no configuradas correctamente');
      }

      const form = new FormData();
      form.append(archivo.categoria, Buffer.from(archivo.buffer), {
        filename: archivo.filename,
        contentType: archivo.mimetype,
      });

      // Enviar a OCR
      const response = await axios.post(documentIntelligenceEndpoint, form, {
        headers: {
          'Ocp-Apim-Subscription-Key': subscriptionKey,
          ...form.getHeaders(),
        },
        timeout: 30000
      });

      const operationLocation = response.headers['operation-location'];
      if (!operationLocation) {
        throw new Error('No se recibió operation-location en la respuesta de OCR');
      }

      // Esperar resultado
      const ocrData = await waitForOcrResult(operationLocation, subscriptionKey);

      // Procesar datos OCR
      const datosExtraidos = await procesarConArchivoTemporal(ocrData);

      return datosExtraidos;

    } catch (error) {
      logger.error(`Error en OCR de tarjeta de propiedad: ${error.message}`);
      await handleProcessingError(sessionId, socketId, `Error en OCR: ${error.message}`, 'ocr_general');
      throw error;
    }
  }

  // Función para esperar confirmación del usuario
  // ========== CORRECCIÓN EN EL PROCESADOR ==========

  // OPCIÓN 1: Cambiar la validación para NO verificar socketId específico
  async function esperarConfirmacionUsuario(sessionId, socketId, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(async () => {
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'esperando_confirmacion', 'false',
          'timeout_confirmacion', 'true'
        );

        notifyUser(userId, 'vehiculo:confirmacion:timeout', {
          sessionId,
          socketId,
          mensaje: 'Tiempo de espera agotado para confirmación'
        });

        reject(new Error('Timeout: No se recibió confirmación del usuario'));
      }, timeoutMs);

      const eventName = `vehiculo:confirmacion:respuesta:${sessionId}`;

      logger.info(`👂 Registrando listener para evento: ${eventName}`);
      eventEmitter.debug(eventName);

      const handleConfirmacion = async (data) => {
        logger.info(`🎯 Evento recibido: ${eventName}`, data);

        clearTimeout(timeoutId);

        // ✅ SOLO VALIDAR sessionId, NO socketId
        if (data.sessionId === sessionId) {
          logger.info(`✅ Confirmación válida recibida para sesión ${sessionId}: ${data.accion}`);
          logger.info(`🔄 SocketId del evento: ${data.socketId}, SocketId esperado: ${socketId}`);
          resolve(data);
        } else {
          logger.warn(`⚠️ SessionId no coincide - esperado: ${sessionId}, recibido: ${data.sessionId}`);
        }
      };

      eventEmitter.once(eventName, handleConfirmacion);

      const listenersCount = eventEmitter.listenerCount(eventName);
      logger.info(`✅ Listener registrado. Total listeners para ${eventName}: ${listenersCount}`);

      redisClient.hmset(`vehiculo:${sessionId}:confirmacion`,
        'esperando', 'true',
        'timestamp', Date.now().toString(),
        'callback', eventName
      );
    });
  }

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
  async function handleProcessingError(userId, sessionId, socketId, errorMessage, errorType, vehiculo = null) {
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
      notifyUser(userId, 'vehiculo:procesamiento:error', {
        sessionId,
        socketId,
        tipo: 'creacion',
        error: errorMessage,
        errorTipo: errorType,
        mensaje: 'Error al crear el vehículo',
        critico: true,
        ...(errorType.includes('validacion_placa_existente') && { vehiculo: vehiculo })
      });

      // Si hay un vehículo creado, eliminarlo
      if (vehiculo.id && !errorType.includes('validacion_placa_existente')) {
        try {
          await Vehiculo.destroy({ where: { id: vehiculo.id } });
          logger.info(`Vehículo con ID ${vehiculo.id} eliminado debido a error: ${errorType}`);
        } catch (deleteError) {
          logger.error(`Error al eliminar vehículo ${vehiculo.id}: ${deleteError.message}`);
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
  async function handleDocumentError(userId, sessionId, socketId, categoria, errorMessage, vehiculoId = null) {
    try {
      // ✅ Actualizar Redis con error específico del documento
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'estado', 'error',
        'error', `Error al procesar documento ${categoria}: ${errorMessage}`
      );
      await redisClient.hset(`vehiculo:${sessionId}`, `documento_${categoria}_error`, errorMessage);

      // Notificar error específico del documento
      notifyUser(userId, 'vehiculo:procesamiento:error', {
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
    const userId = job.opts.userId;

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
      notifyUser(userId, 'vehiculo:procesamiento:inicio', {
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

      notifyUser(userId, 'vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Verificando vehículo...',
        progreso: 10
      });

      const vehiculo = await Vehiculo.findByPk(vehiculoId);
      if (!vehiculo) {
        const errorMsg = `No se encontró el vehículo con ID: ${vehiculoId}`;
        await handleProcessingError(userId, sessionId, socketId, errorMsg, 'vehiculo_no_encontrado');
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

        notifyUser(userId, 'vehiculo:procesamiento:progreso', {
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
            await handleProcessingError(userId, sessionId, socketId, errorMsg, 'validacion_placa_existente');
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

        notifyUser(userId, 'vehiculo:procesamiento:completado', {
          sessionId,
          socketId,
          tipo: 'actualizacion',
          vehiculo: vehiculoActualizado,
          documentos: [],
          mensaje: 'Vehículo actualizado exitosamente',
          progreso: 100
        });

        notifyUser(userId, 'vehiculo:actualizado', {
          vehiculo: vehiculoActualizado,
          documentosActualizados: [],
          categoriasActualizadas: []
        });

        const { id, nombre } = await User.findByPk(userId);

        notificarGlobal('vehiculo:actualizado-global', {
          usuarioId: id,
          usuarioNombre: nombre,
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

      notifyUser(userId, 'vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Validando documentos para actualización...',
        progreso: 30
      });

      // Validar que el número de archivos coincida con las categorías
      if (adaptedFiles.length !== categorias.length) {
        const errorMsg = `El número de archivos (${adaptedFiles.length}) no coincide con el número de categorías (${categorias.length})`;
        await handleProcessingError(userId, sessionId, socketId, errorMsg, 'validacion_cantidad_archivos');
        throw new Error(errorMsg);
      }

      // Paso 4: Procesar documentos y OCR si es necesario
      const totalArchivos = adaptedFiles.length;
      let datosExtraidos = null;

      for (let i = 0; i < adaptedFiles.length; i++) {
        const archivo = adaptedFiles[i];
        const progreso = 30 + ((i + 1) / totalArchivos) * 40; // De 30% a 70%

        await redisClient.hmset(`vehiculo:${sessionId}`,
          'procesados', (i + 1).toString(),
          'progreso', Math.round(progreso).toString(),
          'mensaje', `Procesando documento ${archivo.categoria} (${i + 1}/${totalArchivos})...`,
          'documento_actual', archivo.categoria
        );

        notifyUser(userId, 'vehiculo:procesamiento:progreso', {
          sessionId,
          socketId,
          mensaje: `Procesando documento ${archivo.categoria} (${i + 1}/${totalArchivos})...`,
          progreso: Math.round(progreso)
        });

        try {
          // Guardar documento temporalmente
          const fileInfo = await saveTemporaryDocument(archivo, sessionId, archivo.categoria);

          await redisClient.set(
            `vehiculo:${sessionId}:files:${archivo.categoria}`,
            JSON.stringify(fileInfo),
            'EX', 3600
          );

          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${archivo.categoria}_procesado`, 'true');
          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${archivo.categoria}_size`, fileInfo.size.toString());

          logger.info(`Documento ${archivo.categoria} procesado y guardado temporalmente`);

          // ====== PROCESAR OCR PARA TARJETA DE PROPIEDAD ======
          if (archivo.categoria === 'TARJETA_DE_PROPIEDAD') {
            job.progress(Math.round(progreso) + 5);
            await redisClient.hmset(`vehiculo:${sessionId}`,
              'progreso', (Math.round(progreso) + 5).toString(),
              'mensaje', 'Extrayendo datos de la tarjeta de propiedad...',
              'documento_actual', 'OCR_TARJETA_DE_PROPIEDAD'
            );

            notifyUser(userId, 'vehiculo:procesamiento:progreso', {
              sessionId,
              socketId,
              mensaje: 'Extrayendo datos de la tarjeta de propiedad...',
              progreso: Math.round(progreso) + 5
            });

            // Ejecutar OCR usando la misma función que en creación
            datosExtraidos = await ejecutarOCRTarjetaPropiedad(archivo, sessionId, socketId);

            console.log('Datos extraídos del OCR:', datosExtraidos);

            // Almacenar datos extraídos en Redis
            await redisClient.set(
              `vehiculo:${sessionId}:ocr:TARJETA_DE_PROPIEDAD`,
              JSON.stringify(datosExtraidos),
              'EX', 3600
            );

            logger.info(`OCR completado para tarjeta de propiedad. Datos extraídos:`, datosExtraidos);

            // ====== VALIDACIÓN CRÍTICA: COMPARAR PLACAS ======
            if (!datosExtraidos || !datosExtraidos.placa) {
              const errorMsg = 'No se pudo extraer la placa de la tarjeta de propiedad';
              await handleProcessingError(userId, sessionId, socketId, errorMsg, 'ocr_sin_placa');
              throw new Error(errorMsg);
            }

            // Comparar placa extraída con placa del vehículo actual
            const placaExtraida = datosExtraidos.placa.trim().toUpperCase();
            const placaVehiculo = vehiculo.placa.trim().toUpperCase();

            if (placaExtraida !== placaVehiculo) {
              const errorMsg = `DISCREPANCIA DE PLACA DETECTADA: La placa extraída de la tarjeta de propiedad (${placaExtraida}) no coincide con la placa del vehículo actual (${placaVehiculo}). Verifique que está actualizando el vehículo correcto.`;
              logger.error(errorMsg);

              await handleProcessingError(userId, sessionId, socketId, errorMsg, 'discrepancia_placa', {
                placaExtraida,
                placaVehiculo,
                vehiculoId: vehiculo.id
              });

              throw new Error(errorMsg);
            }

            logger.info(`✅ Validación de placa exitosa: ${placaExtraida} coincide con ${placaVehiculo}`);

            // Marcar OCR como completado
            await redisClient.hset(`vehiculo:${sessionId}`, 'ocr_tarjeta_completado', 'true');
            await redisClient.hset(`vehiculo:${sessionId}`, 'ocr_tarjeta_data', JSON.stringify(datosExtraidos));
          }

        } catch (error) {
          logger.error(`Error procesando documento ${archivo.categoria}: ${error.message}`);
          await handleDocumentError(userId, sessionId, socketId, archivo.categoria, error.message);
          throw new Error(error.message);
        }
      }

      // ====== PASO 5: SOLICITAR CONFIRMACIÓN SI HAY DATOS DE OCR ======
      let datosFinales = null;

      if (datosExtraidos) {
        job.progress(75);
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'progreso', '75',
          'estado', 'esperando_confirmacion',
          'mensaje', 'OCR completado. Esperando confirmación del usuario...',
          'esperando_confirmacion', 'true'
        );

        // Enviar ÚNICAMENTE los datos de la tarjeta de propiedad
        notifyUser(userId, 'vehiculo:confirmacion:requerida', {
          sessionId,
          socketId,
          mensaje: 'Datos extraídos de la tarjeta de propiedad. Por favor confirme la información para actualizar el vehículo',
          progreso: 75,
          datosVehiculo: datosExtraidos,
          vehiculoActual: {
            id: vehiculo.id,
            placa: vehiculo.placa,
            marca: vehiculo.marca,
            modelo: vehiculo.modelo
          },
          camposEditables: [
            'propietario_nombre',
            'propietario_identificacion',
            'modelo',
            'linea',
            'fecha_matricula'
          ],
          opciones: {
            confirmar: true,
            editar: true,
            cancelar: true
          }
        });

        logger.info(`Esperando confirmación del usuario para actualizar vehículo con placa: ${datosExtraidos.placa}`);

        // Esperar respuesta del usuario
        const confirmacion = await esperarConfirmacionUsuario(sessionId, socketId);

        // ====== PASO 6: PROCESAR RESPUESTA DEL USUARIO ======
        if (confirmacion.accion === 'cancelar') {
          logger.info(`Usuario canceló la actualización del vehículo con placa: ${datosExtraidos.placa}`);

          await redisClient.del(`vehiculo:${sessionId}:ocr:TARJETA_DE_PROPIEDAD`);

          notifyUser(userId, 'vehiculo:procesamiento:cancelado', {
            sessionId,
            socketId,
            mensaje: 'Actualización de vehículo cancelada por el usuario'
          });

          throw new Error('Actualización cancelada por el usuario');
        }

        // Combinar datos extraídos con modificaciones del usuario
        datosFinales = { ...datosExtraidos, ...confirmacion.datosModificados };

        if (confirmacion.accion === 'editar') {
          logger.info(`Usuario editó los datos del vehículo con placa: ${datosExtraidos.placa}`);

          // Validar campos obligatorios después de edición
          const camposObligatoriosEditados = ['propietario_nombre', 'propietario_identificacion', 'modelo', 'linea', 'fecha_matricula'];
          const camposFaltantesEditados = camposObligatoriosEditados.filter(
            campo => !datosFinales[campo] || datosFinales[campo].toString().trim() === ''
          );

          if (camposFaltantesEditados.length > 0) {
            const errorMsg = `Los siguientes campos obligatorios no pueden estar vacíos: ${camposFaltantesEditados.join(', ')}`;
            await handleProcessingError(userId, sessionId, socketId, errorMsg, 'validacion_campos_editados_obligatorios');
            throw new Error(errorMsg);
          }

          logger.info(`Datos actualizados por el usuario:`, datosFinales);
        }

        // ====== ACTUALIZAR DATOS DEL VEHÍCULO CON DATOS FINALES ======
        job.progress(80);
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'progreso', '80',
          'mensaje', 'Actualizando datos del vehículo con información confirmada...',
          'esperando_confirmacion', 'false'
        );

        notifyUser(userId, 'vehiculo:procesamiento:progreso', {
          sessionId,
          socketId,
          mensaje: 'Actualizando datos del vehículo con información confirmada...',
          progreso: 80
        });

        // Preparar campos para actualizar (excluyendo la placa ya validada)
        const camposActualizar = { ...datosFinales };
        delete camposActualizar.placa; // No actualizar la placa ya que debe coincidir

        // Actualizar el vehículo con los datos finales
        await vehiculo.update(camposActualizar);

        logger.info(`Vehículo ${vehiculoId} actualizado con datos confirmados:`, camposActualizar);

      } else {
        // No hay datos de OCR, continuar directamente
        job.progress(75);
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'progreso', '75',
          'mensaje', 'Continuando con actualización de documentos...'
        );

        notifyUser(userId, 'vehiculo:procesamiento:progreso', {
          sessionId,
          socketId,
          mensaje: 'Continuando con actualización de documentos...',
          progreso: 75
        });
      }

      // Paso 7: Desactivar documentos anteriores de las categorías que se van a actualizar
      job.progress(85);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '85',
        'mensaje', 'Desactivando documentos anteriores...'
      );

      notifyUser(userId, 'vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Desactivando documentos anteriores...',
        progreso: 85
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

      // Paso 8: Subir documentos finales a S3 y crear registros en BD
      job.progress(90);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '90',
        'mensaje', 'Subiendo documentos al almacenamiento...'
      );

      notifyUser(userId, 'vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Subiendo documentos al almacenamiento...',
        progreso: 90
      });

      const documentosCreados = await uploadProcessedDocuments(
        sessionId,
        vehiculoId,
        fechasVigencia,
        true, // isUpdate = true porque es actualización
        categorias
      );

      logger.info(`${documentosCreados.length} documentos subidos exitosamente a S3`);

      // Paso 9: Actualizar fechas de vigencia en el vehículo
      job.progress(95);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '95',
        'mensaje', 'Actualizando fechas de vigencia...'
      );

      notifyUser(userId, 'vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Actualizando fechas de vigencia...',
        progreso: 95
      });

      if (fechasVigencia && Object.keys(fechasVigencia).length > 0) {
        const updateFields = {};
        Object.keys(fechasVigencia).forEach(categoria => {
          const campo = `${categoria.toLowerCase()}_vencimiento`;
          updateFields[campo] = new Date(fechasVigencia[categoria]);
        });

        await vehiculo.update(updateFields);
        logger.info(`Fechas de vigencia actualizadas para vehículo ${vehiculoId}:`, updateFields);
      }

      // ====== FINALIZACIÓN ======
      job.progress(100);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '100',
        'estado', 'completado',
        'mensaje', 'Vehículo actualizado exitosamente',
        'documentos_creados', documentosCreados.length.toString(),
        'fecha_completado', new Date().toISOString()
      );

      // Almacenar información de documentos creados
      for (const doc of documentosCreados) {
        await redisClient.hset(`vehiculo:${sessionId}`, `documento_${doc.document_type}_s3_key`, doc.s3_key);
        await redisClient.hset(`vehiculo:${sessionId}`, `documento_${doc.document_type}_id`, doc.id);
      }

      const vehiculoActualizado = await Vehiculo.findByPk(vehiculoId);

      notifyUser(userId, 'vehiculo:procesamiento:completado', {
        sessionId,
        socketId,
        tipo: 'actualizacion',
        vehiculo: vehiculoActualizado,
        documentos: documentosCreados,
        mensaje: 'Vehículo actualizado exitosamente',
        progreso: 100,
        ocrProcesado: !!datosExtraidos,
        datosConfirmados: !!datosFinales
      });

      notifyUser(userId, 'vehiculo:actualizado', {
        vehiculo: vehiculoActualizado,
        documentosActualizados: documentosCreados,
        categoriasActualizadas: categorias
      });

      logger.info(`Actualización de vehículo completada exitosamente: ${sessionId}`);
      return { vehiculo: vehiculoActualizado, documentos: documentosCreados };

    } catch (error) {
      logger.error(`Error en procesamiento de actualización ${sessionId}: ${error.message}`);

      if (!error.message.includes('DISCREPANCIA DE PLACA DETECTADA') &&
        !error.message.includes('Actualización cancelada por el usuario')) {
        await handleProcessingError(userId, sessionId, socketId, error.message, 'general');
      }

      // Limpiar archivos temporales
      try {
        const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);
        await fs.rm(tempDir, { recursive: true, force: true });
        logger.info(`Directorio temporal limpiado para sesión ${sessionId}`);
      } catch (cleanupError) {
        logger.warn(`Error al limpiar directorio temporal: ${cleanupError.message}`);
      }

      throw error;
    } finally {
      await redisClient.expire(`vehiculo:${sessionId}`, 86400); // Expira en 24 horas
    }
  });

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
async function procesarDocumentos(userId, adaptedFiles, categorias, datosVehiculo, socketId) {
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
      userId,
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