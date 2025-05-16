// queue.js - Configuración de la cola optimizada
const axios = require('axios');
const FormData = require('form-data');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const { Vehiculo } = require('../models');
const documentoController = require('../controllers/documentoController');
const logger = require('../utils/logger'); // Asume un módulo de logging

// Configuración de Redis con cliente unificado
const { redisClient, redisOptions } = require('../config/redisClient');
const Queue = require('bull');

// Configuración de logging

// Cola para procesar documentos
const documentQueue = new Queue('document-processing', {
  redis: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: 100, // Mantener solo los últimos 100 trabajos completados
    removeOnFail: 100      // Mantener solo los últimos 100 trabajos fallidos
  }
});

// Cola para la validación final y creación del vehículo
const vehicleCreationQueue = new Queue('vehicle-creation', {
  redis: redisOptions,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 3000
    },
    removeOnComplete: 100,
    removeOnFail: 100
  }
});

// Configuración para OCR
const documentIntelligenceEndpoint = process.env.DOC_INTELLIGENCE;
const subscriptionKey = process.env.DOC_INTELLIGENCE_KEY;

// Asegurar que las variables de entorno estén definidas
if (!documentIntelligenceEndpoint || !subscriptionKey) {
  logger.error('Variables de entorno para OCR no configuradas correctamente');
  throw new Error('Variables de entorno para OCR no configuradas correctamente');
}

// Mapeo de categorías a nombres de scripts
const scriptMapping = {
  'TARJETA_DE_PROPIEDAD': 'ocrTARJETA_DE_PROPIEDAD.py',
  'SOAT': 'ocrSOAT.py',
  'TECNOMECANICA': 'ocrTECNOMECANICA.py',
  'TARJETA_DE_OPERACION': 'ocrTARJETA_DE_OPERACION.py',
  'POLIZA_CONTRACTUAL': 'ocrPOLIZA_CONTRACTUAL.py',
  'POLIZA_EXTRACONTRACTUAL': 'ocrPOLIZA_EXTRACONTRACTUAL.py',
  'POLIZA_TODO_RIESGO': 'ocrPOLIZA_TODO_RIESGO.py'
}; ``

// Claves para el mapeo de fechas de vencimiento
const mapeoFechas = {
  'SOAT': 'soatVencimiento',
  'TECNOMECANICA': 'tecnomecanicaVencimiento',
  'TARJETA_DE_OPERACION': 'tarjetaDeOperacionVencimiento',
  'POLIZA_CONTRACTUAL': 'polizaContractualVencimiento',
  'POLIZA_EXTRACONTRACTUAL': 'poliza_extra_contractual_vencimiento',
  'POLIZA_TODO_RIESGO': 'polizaTodoRiesgoVencimiento'
};

/**
 * Espera hasta que el proceso OCR se complete
 * @param {string} operationLocation - URL para verificar el estado del OCR
 * @param {string} subscriptionKey - Clave de suscripción para el API
 * @returns {Promise<object>} - Resultado del OCR
 */
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
    throw new Error(`OCR no completado exitosamente. Estado final: ${status}`);
  }

  return result;
}

/**
 * Ejecuta un script Python para procesar datos OCR
 * @param {string} category - Categoría del documento
 * @param {string} scriptName - Nombre del script Python
 * @param {string|null} placa - Placa del vehículo (opcional)
 * @returns {Promise<object>} - Resultado del procesamiento
 */
async function runOcrScript(category, scriptName, filePath, placa = null) {
  return new Promise((resolve, reject) => {
    // Registrar inicio de ejecución
    logger.info(`Ejecutando script ${scriptName} para categoría ${category}${placa ? ` con placa ${placa}` : ''}`);

    // Configurar argumentos del script
    // Pasamos el path del archivo como argumento explícito
    const args = [`./src/scripts/${scriptName}`, `--file=${filePath}`];

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
      logger.error(`Error en script Python (${category}): ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const parsedResult = JSON.parse(stdoutData);
          logger.info(`Script ${scriptName} ejecutado exitosamente`);
          resolve(parsedResult);
        } catch (error) {
          logger.error(`Error al parsear resultado del script ${scriptName}: ${error.message}`);
          reject(new Error(`Error al parsear resultado de script (${category}): ${error.message}. Datos: ${stdoutData.substring(0, 200)}...`));
        }
      } else {
        logger.error(`Script ${scriptName} falló con código ${code}. Error: ${stderrData}`);
        reject(new Error(`Script falló con código ${code} (${category}). Error: ${stderrData}`));
      }
    });

    // Manejar errores del proceso
    pythonProcess.on('error', (error) => {
      logger.error(`Error al iniciar script ${scriptName}: ${error.message}`);
      reject(new Error(`Error al iniciar script: ${error.message}`));
    });
  });
}

/**
 * Procesa datos OCR con archivo temporal
 * @param {string} categoria - Categoría del documento
 * @param {string} scriptName - Nombre del script Python
 * @param {object} ocrData - Datos del OCR
 * @param {string|null} placa - Placa del vehículo (opcional)
 * @returns {Promise<object>} - Resultado del procesamiento
 */
async function procesarConArchivoTemporal(categoria, scriptName, ocrData, placa = null) {
  const uniqueId = uuidv4().substring(0, 8); // Identificador único para evitar colisiones
  const dirPath = path.join(__dirname, '..', '..', 'temp');
  const filePath = path.join(dirPath, `tempOcrData_${categoria}_${uniqueId}.json`);

  try {
    // Crear directorio si no existe
    await fs.mkdir(dirPath, { recursive: true });

    // Guardar datos OCR en formato JSON
    await fs.writeFile(filePath, JSON.stringify(ocrData, null, 2), 'utf8');
    logger.debug(`Archivo temporal creado: ${filePath}`);

    // Ejecutar script Python
    const resultado = await runOcrScript(categoria, scriptName, filePath, placa);

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

    logger.error(`Error al procesar archivo temporal para ${categoria}: ${error.message}`);
    throw error;
  }
}

/**
 * Valida que la placa del documento coincida con la del vehículo
 * @param {string} placaDocumento - Placa extraída del documento
 * @param {string} placaVehiculo - Placa del vehículo registrado
 * @param {string} categoria - Categoría del documento
 * @throws {Error} Si las placas no coinciden
 */
function validarPlaca(placaDocumento, placaVehiculo, categoria) {
  if (!placaDocumento) return;

  if (!placaVehiculo) {
    logger.warn(`No se puede validar placa para ${categoria}: placaVehiculo es null o undefined`);
    return;
  }

  // Normalizar placas para comparación (quitar espacios, guiones, etc.)
  const normalizedPlacaDoc = placaDocumento.replace(/[\s\-_.]/g, '').toUpperCase();
  const normalizedPlacaVeh = placaVehiculo.replace(/[\s\-_.]/g, '').toUpperCase();

  if (normalizedPlacaDoc !== normalizedPlacaVeh) {
    logger.error(`Placas no coinciden en ${categoria}: Documento=${placaDocumento}, Vehículo=${placaVehiculo}`);
    throw new Error(`La placa del documento ${categoria} (${placaDocumento}) no coincide con la placa del vehículo (${placaVehiculo})`);
  }

  logger.info(`Placa validada correctamente para ${categoria}: ${placaDocumento}`);
}

/**
 * Notifica al cliente a través de WebSocket
 * @param {string} socketId - ID del socket del cliente
 * @param {string} evento - Nombre del evento a emitir
 * @param {object} datos - Datos a enviar
 */
function notificarCliente(socketId, evento, datos) {
  if (!socketId) {
    logger.warn(`No se puede notificar evento ${evento}: socketId no definido`);
    return;
  }

  if (!global.io) {
    logger.error(`No se puede notificar evento ${evento}: global.io no inicializado`);
    return;
  }

  try {
    global.io.to(socketId).emit(evento, datos);
    logger.debug(`Evento ${evento} enviado a cliente ${socketId}`);
  } catch (error) {
    logger.error(`Error al enviar evento ${evento} a cliente ${socketId}: ${error.message}`);
  }
}

/**
 * Notifica al cliente a través de WebSocket
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

/**
 * Obtiene la placa del vehículo desde los datos de la tarjeta de propiedad
 * @param {string} sessionId - ID de la sesión
 * @returns {Promise<string>} - Placa del vehículo
 */
async function obtenerPlacaVehiculo(sessionId) {
  let intentos = 0;
  const maxIntentos = 8;
  const tiempoEspera = 2000; // 2 segundos
  const redisKey = `vehiculo:${sessionId}:documentos`;

  // Verificar si la sesión existe antes de intentar obtener datos específicos
  const existeSesion = await redisClient.exists(`vehiculo:${sessionId}`);
  if (!existeSesion) {
    logger.error(`La sesión ${sessionId} no existe en Redis`);
    throw new Error(`La sesión ${sessionId} no existe`);
  }

  // Verificar todas las claves relacionadas con esta sesión para diagnóstico
  const todasLasClaves = await redisClient.keys(`vehiculo:${sessionId}*`);
  logger.debug(`Claves disponibles para sesión ${sessionId}: ${todasLasClaves.join(', ')}`);

  while (intentos < maxIntentos) {
    try {
      // Verificar primero si la clave de documentos existe
      const existeDocumentos = await redisClient.exists(redisKey);
      if (!existeDocumentos) {
        logger.warn(`La clave ${redisKey} no existe en Redis. Esperando a que sea creada...`);
        await new Promise(resolve => setTimeout(resolve, tiempoEspera));
        intentos++;
        continue;
      }

      // Verificar si el documento específico existe en el hash
      const tieneDocumento = await redisClient.hexists(redisKey, 'TARJETA_DE_PROPIEDAD');
      if (!tieneDocumento) {
        logger.warn(`No se encontró el documento TARJETA_DE_PROPIEDAD en ${redisKey}`);
        await new Promise(resolve => setTimeout(resolve, tiempoEspera));
        intentos++;
        continue;
      }

      // Obtener datos de la tarjeta
      const tarjetaPropiedadData = await redisClient.hget(redisKey, 'TARJETA_DE_PROPIEDAD');

      // Verificar contenido para diagnóstico
      if (tarjetaPropiedadData) {
        logger.debug(`Datos obtenidos de Redis (primeros 100 caracteres): ${tarjetaPropiedadData.substring(0, 100)}...`);

        try {
          const parsedData = JSON.parse(tarjetaPropiedadData);

          // Verificar estructura del objeto
          if (!parsedData) {
            logger.warn(`Los datos de TARJETA_DE_PROPIEDAD se parsearon como null o undefined`);
            await new Promise(resolve => setTimeout(resolve, tiempoEspera));
            intentos++;
            continue;
          }

          // Registrar todas las claves para diagnóstico
          logger.debug(`Claves en parsedData: ${Object.keys(parsedData).join(', ')}`);

          // Verificar si existe la placa
          if (parsedData.placa) {
            logger.info(`Placa obtenida para sesión ${sessionId}: ${parsedData.placa}`);
            return parsedData.placa;
          } else {
            logger.warn(`El documento TARJETA_DE_PROPIEDAD no contiene información de placa`);
          }
        } catch (parseError) {
          logger.error(`Error al parsear datos de TARJETA_DE_PROPIEDAD: ${parseError.message}`);
          logger.debug(`Datos que causaron el error: ${tarjetaPropiedadData}`);
        }
      } else {
        logger.warn(`Se encontró la clave pero el valor es null o vacío`);
      }

      // Esperar antes de reintentar
      await new Promise(resolve => setTimeout(resolve, tiempoEspera));
      intentos++;
      logger.debug(`Intento ${intentos}/${maxIntentos} para obtener placa, sesión ${sessionId}`);
    } catch (error) {
      logger.error(`Error al obtener placa, intento ${intentos}: ${error.message}`);
      // Esperar antes de reintentar
      await new Promise(resolve => setTimeout(resolve, tiempoEspera));
      intentos++;
    }
  }

  // Si llegamos aquí, no se pudo obtener la placa después de todos los intentos
  const estadoSesion = await redisClient.hgetall(`vehiculo:${sessionId}`);
  logger.error(`Estado actual de la sesión: ${JSON.stringify(estadoSesion)}`);

  throw new Error(`No se pudo obtener datos de la tarjeta de propiedad después de ${maxIntentos} intentos`);
}

/**
 * Inicia el procesamiento de documentos
 * @param {Array<object>} files - Archivos a procesar
 * @param {Array<string>} categorias - Categorías correspondientes a los archivos
 * @param {string} socketId - ID del socket para notificaciones
 * @returns {Promise<string>} - ID de la sesión creada
 */
async function procesarDocumentos(files, categorias, socketId) {
  try {
    // Validar entradas
    if (!Array.isArray(files) || !Array.isArray(categorias) || files.length !== categorias.length) {
      throw new Error('Los parámetros files y categorias deben ser arrays del mismo tamaño');
    }

    if (!files.length) {
      throw new Error('No se han proporcionado archivos para procesar');
    }

    // Validar que todas las categorías sean válidas
    for (const categoria of categorias) {
      if (!scriptMapping[categoria]) {
        throw new Error(`Categoría no válida: ${categoria}`);
      }
    }

    const sessionId = uuidv4();
    const totalFiles = files.length;

    logger.info(`Iniciando procesamiento de documentos. Sesión: ${sessionId}, Total: ${totalFiles}`);

    // Guardar información de la sesión en Redis con hmset
    await redisClient.hmset(`vehiculo:${sessionId}`, {
      'totalDocumentos': totalFiles,
      'procesados': 0,
      'socketId': socketId,
      'estado': 'en_proceso',
      'fechaInicio': new Date().toISOString()
    });

    // Verificar existencia de la tarjeta de propiedad
    const tarjetaPropiedadIndex = categorias.findIndex(cat => cat === 'TARJETA_DE_PROPIEDAD');

    if (tarjetaPropiedadIndex === -1) {
      // Actualizar estado en Redis
      await redisClient.hmset(`vehiculo:${sessionId}`, {
        'estado': 'fallido',
        'error': 'La Tarjeta de Propiedad es obligatoria'
      });

      // Notificar al cliente
      notificarCliente(socketId, 'error-procesamiento', {
        mensaje: 'La Tarjeta de Propiedad es obligatoria'
      });

      throw new Error('La Tarjeta de Propiedad es obligatoria');
    }

    // Añadir primero la Tarjeta de Propiedad a la cola
    logger.info(`Añadiendo Tarjeta de Propiedad a la cola. Sesión: ${sessionId}`);
    await documentQueue.add('procesar-documento', {
      file: files[tarjetaPropiedadIndex],
      categoria: categorias[tarjetaPropiedadIndex],
      sessionId,
      esTarjetaPropiedad: true,
      index: tarjetaPropiedadIndex
    }, {
      priority: 1, // Alta prioridad para tarjeta de propiedad
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 3000
      }
    });

    // Añadir el resto de documentos a la cola
    for (let i = 0; i < files.length; i++) {
      if (i !== tarjetaPropiedadIndex) {
        logger.info(`Añadiendo documento ${categorias[i]} a la cola. Sesión: ${sessionId}`);
        await documentQueue.add('procesar-documento', {
          file: files[i],
          categoria: categorias[i],
          sessionId,
          esTarjetaPropiedad: false,
          index: i
        }, {
          priority: 10, // Menor prioridad para otros documentos
          delay: 500 * i // Pequeño retraso escalonado para evitar sobrecarga
        });
      }
    }

    // Establecer un tiempo de expiración en Redis (24 horas)
    const REDIS_EXPIRY = 24 * 60 * 60; // 24 horas en segundos
    await redisClient.expire(`vehiculo:${sessionId}`, REDIS_EXPIRY);
    await redisClient.expire(`vehiculo:${sessionId}:documentos`, REDIS_EXPIRY);

    logger.info(`Procesamiento iniciado correctamente. Sesión: ${sessionId}`);
    return sessionId;
  } catch (error) {
    logger.error(`Error al iniciar procesamiento: ${error.message}`, error);
    throw error;
  }
}

// Procesar cada documento individualmente
documentQueue.process('procesar-documento', async (job) => {
  const { file, categoria, sessionId, esTarjetaPropiedad, index } = job.data;
  logger.info(`Procesando documento ${categoria} (${index}) para sesión: ${sessionId}`);

  try {
    // Verificar estado de la sesión
    const estadoSesion = await redisClient.hget(`vehiculo:${sessionId}`, 'estado');
    if (estadoSesion === 'fallido') {
      logger.warn(`Saltando procesamiento de ${categoria}: la sesión ${sessionId} está marcada como fallida`);
      return { skipped: true, reason: 'session_failed' };
    }

    try {
      // Guardar temporalmente el documento
      const fileInfo = await documentoController.saveTemporaryDocument(
        file,
        sessionId,
        categoria
      );

      // Guardar referencia en Redis
      const fileInfoKey = `vehiculo:${sessionId}:files:${categoria}`;
      await redisClient.set(fileInfoKey, JSON.stringify(fileInfo), 'EX', 24 * 60 * 60);

      logger.info(`Documento ${categoria} guardado temporalmente en: ${fileInfo.path}`);
    } catch (error) {
      logger.error(`Error al guardar documento temporal: ${error.message}`);
      // Continuar con el proceso aunque falle el guardado
    }

    // Actualizar progreso
    job.progress(10);

    // Obtener la placa del vehículo si no es la tarjeta de propiedad
    let placaVehiculo = null;
    if (!esTarjetaPropiedad) {
      try {
        placaVehiculo = await obtenerPlacaVehiculo(sessionId);

        // Verificar si la placa ya existe en la base de datos
        if (placaVehiculo) {
          const vehiculoExistente = await Vehiculo.findOne({ where: { placa: placaVehiculo } });
          if (vehiculoExistente) {
            logger.warn(`Placa duplicada detectada: ${placaVehiculo} (ID: ${vehiculoExistente.id})`);

            // Marcar sesión como fallida directamente aquí
            await redisClient.hmset(`vehiculo:${sessionId}`, {
              'estado': 'fallido',
              'error': `Vehículo con placa ${placaVehiculo} ya existe en el sistema`
            });

            // Notificar al cliente directamente aquí
            const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
            notificarCliente(socketId, 'error-procesamiento', {
              etapa: 'verificacion-placa',  // Un nombre más específico para esta etapa
              mensaje: `Vehículo con placa ${placaVehiculo} ya existe en el sistema`,
              placa: placaVehiculo,
              vehiculoId: vehiculoExistente.id
            });

            // Lanzar un error simple que no necesite más procesamiento
            const duplicadoError = new Error(`Vehículo con placa ${placaVehiculo} ya existe en el sistema`);
            duplicadoError.handled = true;  // Marca que ya ha sido manejado
            throw duplicadoError;
          }
        }
      } catch (error) {
        // Si el error ya fue manejado (es un duplicado), simplemente propagarlo
        if (error.handled) {
          throw error;
        }

        // Para otros errores, seguir con el manejo normal
        logger.error(`Error al obtener placa del vehículo: ${error.message}`);
        throw new Error(`No se puede procesar ${categoria}: ${error.message}`);
      }
    }

    // Verificar formato del archivo
    if (!file || !file.buffer || !file.filename || !file.mimetype) {
      throw new Error(`Formato de archivo inválido para ${categoria}`);
    }

    // Actualizar progreso
    job.progress(20);

    // Preparar formulario para OCR
    const form = new FormData();
    form.append(categoria, Buffer.from(file.buffer), {
      filename: file.filename,
      contentType: file.mimetype,
    });

    // Enviar archivo a OCR
    logger.info(`Enviando ${categoria} a OCR. Sesión: ${sessionId}`);
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
      logger.error(`Error al enviar a OCR ${categoria}: ${error.message}`);
      throw new Error(`Error al enviar documento a OCR: ${error.response?.data?.error || error.message}`);
    }

    // Actualizar progreso
    job.progress(30);

    // Obtener y validar operation-location
    const operationLocation = response.headers['operation-location'];
    if (!operationLocation) {
      throw new Error('No se recibió operation-location del servicio OCR');
    }

    // Esperar resultado del OCR con manejo de errores
    logger.info(`Esperando resultado OCR para ${categoria}. Sesión: ${sessionId}`);
    let ocrData;
    try {
      ocrData = await waitForOcrResult(operationLocation, subscriptionKey);
    } catch (error) {
      logger.error(`Error al esperar resultado OCR para ${categoria}: ${error.message}`);
      throw new Error(`Error en proceso OCR: ${error.message}`);
    }

    // Actualizar progreso
    job.progress(60);

    // Determinar qué script usar
    const scriptName = scriptMapping[categoria];
    if (!scriptName) {
      throw new Error(`No se encontró script para categoría: ${categoria}`);
    }

    // Procesar con script Python
    logger.info(`Ejecutando script ${scriptName} para ${categoria}. Sesión: ${sessionId}`);
    let resultado;
    try {
      resultado = await procesarConArchivoTemporal(categoria, scriptName, ocrData, placaVehiculo);
    } catch (error) {
      logger.error(`Error al procesar ${categoria} con script: ${error.message}`);
      throw new Error(`Error al procesar documento con script: ${error.message}`);
    }

    // Validar resultado
    if (!resultado) {
      throw new Error(`El script no devolvió resultados para ${categoria}`);
    }

    // Validar placa en el resultado si corresponde
    if (!esTarjetaPropiedad && resultado.placa && placaVehiculo) {
      validarPlaca(resultado.placa, placaVehiculo, categoria);
    }

    // Actualizar progreso
    job.progress(90);

    // Guardar resultado en Redis
    await redisClient.hset(`vehiculo:${sessionId}:documentos`, categoria, JSON.stringify(resultado));
    logger.info(`Documento ${categoria} procesado y guardado. Sesión: ${sessionId}`);

    // Incrementar contador de documentos procesados con operación atómica
    const procesados = await redisClient.hincrby(`vehiculo:${sessionId}`, 'procesados', 1);
    const total = await redisClient.hget(`vehiculo:${sessionId}`, 'totalDocumentos');

    // Calcular progreso
    const progresoTotal = Math.floor((procesados / parseInt(total)) * 100);
    const completado = procesados === parseInt(total);

    // Emitir evento de progreso a través de WebSocket
    const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
    notificarCliente(socketId, 'documento-procesado', {
      categoria,
      progreso: progresoTotal,
      completado
    });

    // Si todos los documentos han sido procesados, programar la creación del vehículo
    // Verificar de manera atómica para evitar condiciones de carrera
    if (completado) {
      // Actualizar estado para indicar que pasamos a la fase de creación
      await redisClient.hset(`vehiculo:${sessionId}`, 'estado', 'creacion_vehiculo');

      logger.info(`Todos los documentos procesados. Iniciando creación del vehículo. Sesión: ${sessionId}`);
      await vehicleCreationQueue.add('crear-vehiculo', { sessionId }, {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 3000
        }
      });
    }

    // Actualizar progreso
    job.progress(100);
    return { success: true, categoria };
  } catch (error) {
    logger.error(`Error al procesar documento ${categoria}: ${error.message}`, error);

    // Marcar sesión como fallida
    await redisClient.hmset(`vehiculo:${sessionId}`, {
      'estado': 'fallido',
      'error': error.message
    });

    // Notificar error a través de WebSocket
    const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
    notificarCliente(socketId, 'error-procesamiento', {
      etapa: 'creacion-vehiculo',
      mensaje: error.message
    });

    throw error;
  }
});

/**
 * Valida si una cadena es una fecha válida
 * @param {string} dateString - Cadena de fecha a validar
 * @returns {boolean} - Verdadero si es una fecha válida
 */
function isValidDate(dateString) {
  if (!dateString) return false;

  // Intentar parsear como fecha ISO
  const timestamp = Date.parse(dateString);
  if (isNaN(timestamp)) return false;

  // Verificar que la fecha esté en un rango razonable (entre 2000 y 2050)
  const date = new Date(timestamp);
  const year = date.getFullYear();
  return year >= 2000 && year <= 2050;
}

// Configurar los eventos para monitoreo de colas
documentQueue.on('error', (error) => {
  logger.error(`Error en cola de documentos: ${error.message}`, error);
});

// Manejadores para trabajos completados y fallidos
documentQueue.on('completed', (job) => {
  logger.info(`Trabajo de documento completado: ${job.id}, categoría: ${job.data.categoria}`);
});

documentQueue.on('failed', (job, error) => {
  logger.error(`Trabajo de documento fallido: ${job.id}, categoría: ${job.data.categoria}, error: ${error.message}`);
});

// Procesar la creación final del vehículo
vehicleCreationQueue.process('crear-vehiculo', async (job) => {
  const { sessionId } = job.data;
  logger.info(`Procesando creación de vehículo para sesión: ${sessionId}`);

  try {
    // Actualizar progreso
    job.progress(10);

    // Adquirir un bloqueo para evitar procesamiento duplicado
    const lockKey = `lock:vehiculo:${sessionId}`;
    const lockValue = uuidv4();
    const lockAcquired = await redisClient.set(lockKey, lockValue, 'NX', 'EX', 60); // Lock por 60 segundos

    if (!lockAcquired) {
      logger.warn(`Otro proceso ya está creando el vehículo para la sesión ${sessionId}`);
      return { skipped: true, reason: 'already_processing' };
    }

    // Verificar estado de la sesión
    const estadoSesion = await redisClient.hget(`vehiculo:${sessionId}`, 'estado');
    if (estadoSesion === 'fallido') {
      logger.warn(`Saltando creación de vehículo: la sesión ${sessionId} está marcada como fallida`);
      await redisClient.del(lockKey); // Liberar el bloqueo
      return { skipped: true, reason: 'session_failed' };
    }

    if (estadoSesion === 'completado') {
      logger.warn(`El vehículo ya fue creado para la sesión ${sessionId}`);
      await redisClient.del(lockKey); // Liberar el bloqueo
      return { skipped: true, reason: 'already_completed' };
    }

    // Actualizar progreso
    job.progress(20);

    // Obtener todos los datos procesados
    const documentosData = await redisClient.hgetall(`vehiculo:${sessionId}:documentos`);
    if (!documentosData || Object.keys(documentosData).length === 0) {
      throw new Error('No se encontraron documentos procesados');
    }

    // Verificar que tengamos la tarjeta de propiedad
    if (!documentosData['TARJETA_DE_PROPIEDAD']) {
      throw new Error('Falta la Tarjeta de Propiedad procesada');
    }

    // Parsear datos de la tarjeta de propiedad
    let tarjetaDePropiedad;
    try {
      tarjetaDePropiedad = JSON.parse(documentosData['TARJETA_DE_PROPIEDAD']);
    } catch (error) {
      logger.error(`Error al parsear datos de la Tarjeta de Propiedad: ${error.message}`);
      throw new Error('Error al parsear datos de la Tarjeta de Propiedad');
    }

    // Validar datos mínimos necesarios de la tarjeta
    if (!tarjetaDePropiedad.placa) {
      throw new Error('La Tarjeta de Propiedad no contiene información de placa');
    }

    // Actualizar progreso
    job.progress(40);

    // Crear objeto de datos base con la información de la tarjeta
    const datos = { ...tarjetaDePropiedad };

    // Verificar campos obligatorios en la tarjeta de propiedad
    const camposObligatorios = ['placa', 'marca', 'linea', 'modelo', "clase_vehiculo"];
    const camposFaltantes = camposObligatorios.filter(campo =>
      !datos[campo] || datos[campo].toString().trim() === ''
    );

    if (camposFaltantes.length > 0) {
      throw new Error(`Faltan campos obligatorios en la Tarjeta de Propiedad: ${camposFaltantes.join(', ')}`);
    }

    // Agregar fechas de vencimiento de los demás documentos
    for (const [categoria, documento] of Object.entries(documentosData)) {
      if (categoria === 'TARJETA_DE_PROPIEDAD') continue;

      let parsedDoc;
      try {
        parsedDoc = JSON.parse(documento);
      } catch (error) {
        logger.error(`Error al parsear datos de ${categoria}: ${error.message}`);
        throw new Error(`Error al parsear datos de ${categoria}`);
      }

      if (mapeoFechas[categoria] && parsedDoc) {
        // Validar placa si existe
        if (parsedDoc.placa) {
          validarPlaca(parsedDoc.placa, tarjetaDePropiedad.placa, categoria);
        }

        // Añadir fecha de vencimiento
        datos[mapeoFechas[categoria]] = parsedDoc[mapeoFechas[categoria]] || null;

        // Validar formato de fecha
        if (datos[mapeoFechas[categoria]] && !isValidDate(datos[mapeoFechas[categoria]])) {
          logger.warn(`Formato de fecha inválido en ${categoria}: ${datos[mapeoFechas[categoria]]}`);
          datos[mapeoFechas[categoria]] = null;
        }
      }
    }

    // Actualizar progreso
    job.progress(60);

    // Verificar requisitos mínimos según tipo de vehículo
    // Por ejemplo, si es un vehículo de servicio público, validar documentos adicionales
    if (datos.servicio === 'PUBLICO') {
      if (!datos.tarjetaDeOperacionVencimiento) {
        throw new Error('Vehículos de servicio público requieren Tarjeta de Operación');
      }

      if (!datos.polizaContractualVencimiento || !datos.poliza_extra_contractual_vencimiento) {
        throw new Error('Vehículos de servicio público requieren pólizas Contractual y Extracontractual');
      }
    }

    // Validar que las fechas de vencimiento sean futuras
    const hoy = new Date();
    for (const [clave, fecha] of Object.entries(mapeoFechas)) {
      if (datos[fecha] && new Date(datos[fecha]) < hoy) {
        logger.warn(`El documento ${clave} está vencido: ${datos[fecha]}`);
        // Aquí podrías decidir si continuar o no, o marcar el vehículo
        datos[`${fecha}Estado`] = 'VENCIDO';
      } else if (datos[fecha]) {
        datos[`${fecha}Estado`] = 'VIGENTE';
      }
    }

    // Actualizar progreso
    job.progress(70);

    // Aquí deberías crear el vehículo en tu base de datos
    // Intenta 3 veces en caso de fallo de conexión
    let nuevoVehiculo = null;
    let intentos = 0;
    const maxIntentos = 3;

    while (intentos < maxIntentos && !nuevoVehiculo) {
      logger.info(`Datos del vehiculo ${JSON.stringify(datos)}`)
      try {
        // En un entorno real, aquí iría la llamada a la base de datos
        nuevoVehiculo = await Vehiculo.create(datos);

        logger.info(`Vehículo creado con placa ${datos.placa}. Sesión: ${sessionId}`);
        break;
      } catch (dbError) {
        intentos++;
        logger.error(`Error al crear vehículo en BD, intento ${intentos}/${maxIntentos}: ${dbError.message}`);
        if (intentos >= maxIntentos) {
          throw new Error(`Error al guardar en base de datos después de ${maxIntentos} intentos: ${dbError.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar 1 segundo antes de reintentar
      }
    }

    // Actualizar progreso
    job.progress(80);

    // Crear resumen de documentos procesados
    const resumenDocumentos = Object.keys(documentosData).map(categoria => ({
      categoria,
      procesadoEn: new Date().toISOString()
    }));

    // Guardar la información del vehículo y el resumen en Redis
    await redisClient.hmset(`vehiculo:${sessionId}`, {
      'estado': 'completado',
      'vehiculoId': nuevoVehiculo.id,
      'placa': nuevoVehiculo.placa,
      'fechaCompletado': new Date().toISOString(),
      'resumenDocumentos': JSON.stringify(resumenDocumentos)
    });

    // ** NUEVO BLOQUE - Subir documentos a S3 **
    try {
      logger.info(`Iniciando subida de documentos a S3 para vehículo: ${nuevoVehiculo.id}, sesión: ${sessionId}`);

      // Llamar a la función para subir los documentos
      const documentosSubidos = await documentoController.uploadProcessedDocuments(sessionId, nuevoVehiculo.id);

      logger.info(`Subida de documentos completada. Total: ${documentosSubidos.length} documentos subidos para vehículo: ${nuevoVehiculo.id}`);

      // Actualizar información en Redis con los documentos subidos
      await redisClient.hmset(`vehiculo:${sessionId}`, {
        'estado': 'completado',
        'documentosSubidos': JSON.stringify(documentosSubidos.map(doc => ({
          id: doc.id,
          tipo: doc.documentType,
          s3Key: doc.s3Key
        }))),
        'fechaCompletado': new Date().toISOString()
      });
    } catch (uploadError) {
      // En caso de error en la subida de documentos, lo registramos pero continuamos
      logger.error(`Error al subir documentos a S3 para vehículo: ${nuevoVehiculo.id}: ${uploadError.message}`);

      // Actualizar estado en Redis indicando el problema
      await redisClient.hmset(`vehiculo:${sessionId}`, {
        'estado': 'completado_con_errores',
        'error_documentos': uploadError.message,
        'fechaCompletado': new Date().toISOString()
      });

      // Si quieres enviar una notificación específica sobre este error
      const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
      notificarCliente(socketId, 'error_documentos', {
        success: false,
        vehiculo: nuevoVehiculo,
        mensaje: 'Error al subir documentos del vehículo',
        error: uploadError.message
      });
    }

    // Actualizar progreso
    job.progress(90);

    // Notificar a través de WebSocket
    const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
    notificarCliente(socketId, 'vehiculo_creado', {
      success: true,
      vehiculo: nuevoVehiculo,
      mensaje: 'Vehículo creado exitosamente',
      detalles: {
        documentosProcesados: Object.keys(documentosData).length,
        fechaCreacion: nuevoVehiculo.fechaCreacion
      }
    });

    // Notificación global a todos los clientes conectados
    notificarGlobal('vehiculo_creado', {
      success: true,
      vehiculo: nuevoVehiculo,
      mensaje: 'Vehículo creado exitosamente',
      detalles: {
        documentosProcesados: Object.keys(documentosData).length,
        fechaCreacion: nuevoVehiculo.fechaCreacion
      }
    });

    // Liberar el bloqueo
    await redisClient.del(lockKey);

    // Actualizar progreso
    job.progress(100);

    logger.info(`Vehículo creado exitosamente. ID: ${nuevoVehiculo.id}, Placa: ${nuevoVehiculo.placa}, Sesión: ${sessionId}`);
    return { success: true, vehiculo: nuevoVehiculo };
  } catch (error) {
    logger.error(`Error al crear vehículo: ${error.message}`, error);

    // Liberar el bloqueo si existe
    const lockKey = `lock:vehiculo:${sessionId}`;
    await redisClient.del(lockKey);

    // Marcar sesión como fallida
    await redisClient.hmset(`vehiculo:${sessionId}`, {
      'estado': 'fallido',
      'error': error.message,
      'fechaError': new Date().toISOString()
    });

    // Notificar error a través de WebSocket
    const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
    notificarCliente(socketId, 'error-procesamiento', {
      etapa: 'creacion-vehiculo',
      mensaje: error.message
    });

    throw error;
  }
});

// Registrar eventos de la cola
vehicleCreationQueue.on('error', (error) => {
  logger.error(`Error en cola de creación de vehículos: ${error.message}`, error);
});

vehicleCreationQueue.on('completed', (job) => {
  logger.info(`Trabajo de creación de vehículo completado: ${job.id}, sesión: ${job.data.sessionId}`);
});

vehicleCreationQueue.on('failed', (job, error) => {
  logger.error(`Trabajo de creación de vehículo fallido: ${job.id}, sesión: ${job.data.sessionId}, error: ${error.message}`);
});

// Función para añadir una tarea a la cola
async function crearVehiculo(sessionId) {
  return await vehicleCreationQueue.add('crear-vehiculo', { sessionId }, {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 3000
    }
  });
}

/**
 * Actualiza los documentos de un vehículo existente
 * @param {Array<object>} files - Archivos a procesar
 * @param {Array<string>} categorias - Categorías correspondientes a los archivos
 * @param {string} vehiculoId - ID del vehículo a actualizar
 * @param {string} socketId - ID del socket para notificaciones
 * @returns {Promise<string>} - ID de la sesión creada
 */
async function actualizarDocumentosVehiculo(files, categorias, vehiculoId, socketId) {
  try {
    // Validar entradas
    if (!Array.isArray(files) || !Array.isArray(categorias) || files.length !== categorias.length) {
      throw new Error('Los parámetros files y categorias deben ser arrays del mismo tamaño');
    }

    if (!files.length) {
      throw new Error('No se han proporcionado archivos para procesar');
    }

    if (!vehiculoId) {
      throw new Error('El ID del vehículo es obligatorio para la actualización');
    }

    // Validar que todas las categorías sean válidas
    for (const categoria of categorias) {
      if (!scriptMapping[categoria]) {
        throw new Error(`Categoría no válida: ${categoria}`);
      }
    }

    // Obtener información del vehículo para validaciones posteriores
    const vehiculo = await Vehiculo.findByPk(vehiculoId);
    if (!vehiculo) {
      throw new Error(`No se encontró ningún vehículo con ID: ${vehiculoId}`);
    }

    const placaVehiculo = vehiculo.placa;
    logger.info(`Iniciando actualización de documentos para vehículo con placa: ${placaVehiculo}`);

    const sessionId = uuidv4();
    const totalFiles = files.length;

    logger.info(`Iniciando procesamiento de documentos para actualización. Sesión: ${sessionId}, Total: ${totalFiles}, Vehículo: ${vehiculoId}`);

    // Guardar información de la sesión en Redis con hmset
    await redisClient.hmset(`vehiculo:${sessionId}`, {
      'totalDocumentos': totalFiles,
      'procesados': 0,
      'socketId': socketId,
      'estado': 'en_proceso',
      'fechaInicio': new Date().toISOString(),
      'vehiculoId': vehiculoId,
      'placa': placaVehiculo,
      'modo': 'actualizacion' // Marcar que es una actualización
    });

    // Añadir documentos a la cola para procesamiento
    for (let i = 0; i < files.length; i++) {
      logger.info(`Añadiendo documento ${categorias[i]} a la cola para actualización. Sesión: ${sessionId}`);
      await documentQueue.add('procesar-documento-actualizacion', {
        file: files[i],
        categoria: categorias[i],
        sessionId,
        vehiculoId,
        placaVehiculo, // Pasamos la placa directamente
        index: i
      }, {
        priority: 5, // Prioridad media
        delay: 300 * i // Pequeño retraso escalonado para evitar sobrecarga
      });
    }

    // Establecer un tiempo de expiración en Redis (24 horas)
    const REDIS_EXPIRY = 24 * 60 * 60; // 24 horas en segundos
    await redisClient.expire(`vehiculo:${sessionId}`, REDIS_EXPIRY);
    await redisClient.expire(`vehiculo:${sessionId}:documentos`, REDIS_EXPIRY);

    logger.info(`Procesamiento de actualización iniciado correctamente. Sesión: ${sessionId}`);
    return sessionId;
  } catch (error) {
    logger.error(`Error al iniciar procesamiento de actualización: ${error.message}`, error);
    throw error;
  }
}

// Procesar cada documento para actualización
documentQueue.process('procesar-documento-actualizacion', async (job) => {
  const { file, categoria, sessionId, vehiculoId, placaVehiculo, index } = job.data;
  logger.info(`Procesando documento ${categoria} (${index}) para actualización de vehículo ${vehiculoId}. Sesión: ${sessionId}`);

  try {
    // Verificar estado de la sesión
    const estadoSesion = await redisClient.hget(`vehiculo:${sessionId}`, 'estado');
    if (estadoSesion === 'fallido') {
      logger.warn(`Saltando procesamiento de ${categoria}: la sesión ${sessionId} está marcada como fallida`);
      return { skipped: true, reason: 'session_failed' };
    }

    try {
      // Guardar temporalmente el documento
      const fileInfo = await documentoController.saveTemporaryDocument(
        file,
        sessionId,
        categoria
      );

      // Guardar referencia en Redis
      const fileInfoKey = `vehiculo:${sessionId}:files:${categoria}`;
      await redisClient.set(fileInfoKey, JSON.stringify(fileInfo), 'EX', 24 * 60 * 60);

      logger.info(`Documento ${categoria} guardado temporalmente en: ${fileInfo.path}`);
    } catch (error) {
      logger.error(`Error al guardar documento temporal: ${error.message}`);
      // Continuar con el proceso aunque falle el guardado
    }

    // Actualizar progreso
    job.progress(10);

    // Verificar formato del archivo
    if (!file || !file.buffer || !file.filename || !file.mimetype) {
      throw new Error(`Formato de archivo inválido para ${categoria}`);
    }

    // Actualizar progreso
    job.progress(20);

    // Preparar formulario para OCR
    const form = new FormData();
    form.append(categoria, Buffer.from(file.buffer), {
      filename: file.filename,
      contentType: file.mimetype,
    });

    // Enviar archivo a OCR
    logger.info(`Enviando ${categoria} a OCR para actualización. Sesión: ${sessionId}`);
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
      logger.error(`Error al enviar a OCR ${categoria}: ${error.message}`);
      throw new Error(`Error al enviar documento a OCR: ${error.response?.data?.error || error.message}`);
    }

    // Actualizar progreso
    job.progress(30);

    // Obtener y validar operation-location
    const operationLocation = response.headers['operation-location'];
    if (!operationLocation) {
      throw new Error('No se recibió operation-location del servicio OCR');
    }

    // Esperar resultado del OCR con manejo de errores
    logger.info(`Esperando resultado OCR para ${categoria}. Sesión: ${sessionId}`);
    let ocrData;
    try {
      ocrData = await waitForOcrResult(operationLocation, subscriptionKey);
    } catch (error) {
      logger.error(`Error al esperar resultado OCR para ${categoria}: ${error.message}`);
      throw new Error(`Error en proceso OCR: ${error.message}`);
    }

    // Actualizar progreso
    job.progress(60);

    // Determinar qué script usar
    const scriptName = scriptMapping[categoria];
    if (!scriptName) {
      throw new Error(`No se encontró script para categoría: ${categoria}`);
    }

    // Procesar con script Python
    logger.info(`Ejecutando script ${scriptName} para ${categoria}. Sesión: ${sessionId}`);
    let resultado;
    try {
      resultado = await procesarConArchivoTemporal(categoria, scriptName, ocrData, placaVehiculo);
    } catch (error) {
      logger.error(`Error al procesar ${categoria} con script: ${error.message}`);
      throw new Error(`Error al procesar documento con script: ${error.message}`);
    }

    // Validar resultado
    if (!resultado) {
      throw new Error(`El script no devolvió resultados para ${categoria}`);
    }

    // Validar placa en el resultado si corresponde
    if (resultado.placa && placaVehiculo) {
      validarPlaca(resultado.placa, placaVehiculo, categoria);
    }

    // Actualizar progreso
    job.progress(90);

    // Guardar resultado en Redis
    await redisClient.hset(`vehiculo:${sessionId}:documentos`, categoria, JSON.stringify(resultado));
    logger.info(`Documento ${categoria} procesado y guardado para actualización. Sesión: ${sessionId}`);

    // Incrementar contador de documentos procesados con operación atómica
    const procesados = await redisClient.hincrby(`vehiculo:${sessionId}`, 'procesados', 1);
    const total = await redisClient.hget(`vehiculo:${sessionId}`, 'totalDocumentos');

    // Calcular progreso
    const progresoTotal = Math.floor((procesados / parseInt(total)) * 100);
    const completado = procesados === parseInt(total);

    // Emitir evento de progreso a través de WebSocket
    const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
    notificarCliente(socketId, 'documento-procesado', {
      categoria,
      progreso: progresoTotal,
      completado
    });

    // Si todos los documentos han sido procesados, programar la actualización del vehículo
    if (completado) {
      // Actualizar estado para indicar que pasamos a la fase de actualización
      await redisClient.hset(`vehiculo:${sessionId}`, 'estado', 'actualizacion_vehiculo');

      logger.info(`Todos los documentos procesados. Iniciando actualización del vehículo. Sesión: ${sessionId}`);
      await vehicleCreationQueue.add('actualizar-vehiculo', { sessionId, vehiculoId }, {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 3000
        }
      });
    }

    // Actualizar progreso
    job.progress(100);
    return { success: true, categoria };
  } catch (error) {
    logger.error(`Error al procesar documento ${categoria} para actualización: ${error.message}`, error);

    // Marcar sesión como fallida
    await redisClient.hmset(`vehiculo:${sessionId}`, {
      'estado': 'fallido',
      'error': error.message
    });

    // Notificar error a través de WebSocket
    const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
    notificarCliente(socketId, 'error-procesamiento', {
      etapa: 'actualizacion-documento',
      mensaje: error.message,
      categoria
    });

    throw error;
  }
});

// Corrección para el proceso de actualizar-vehiculo
vehicleCreationQueue.process('actualizar-vehiculo', async (job) => {
  const { sessionId, vehiculoId } = job.data;
  logger.info(`Procesando actualización de vehículo ID ${vehiculoId}. Sesión: ${sessionId}`);

  try {
    // Actualizar progreso
    job.progress(10);

    // Adquirir un bloqueo para evitar procesamiento duplicado
    const lockKey = `lock:vehiculo:${sessionId}`;
    const lockValue = uuidv4();
    const lockAcquired = await redisClient.set(lockKey, lockValue, 'NX', 'EX', 60); // Lock por 60 segundos

    if (!lockAcquired) {
      logger.warn(`Otro proceso ya está actualizando el vehículo para la sesión ${sessionId}`);
      return { skipped: true, reason: 'already_processing' };
    }

    // Verificar estado de la sesión
    const estadoSesion = await redisClient.hget(`vehiculo:${sessionId}`, 'estado');
    if (estadoSesion === 'fallido') {
      logger.warn(`Saltando actualización de vehículo: la sesión ${sessionId} está marcada como fallida`);
      await redisClient.del(lockKey); // Liberar el bloqueo
      return { skipped: true, reason: 'session_failed' };
    }

    if (estadoSesion === 'completado') {
      logger.warn(`El vehículo ya fue actualizado para la sesión ${sessionId}`);
      await redisClient.del(lockKey); // Liberar el bloqueo
      return { skipped: true, reason: 'already_completed' };
    }

    // Obtener el vehículo de la base de datos
    const vehiculo = await Vehiculo.findByPk(vehiculoId);
    if (!vehiculo) {
      throw new Error(`No se encontró el vehículo con ID ${vehiculoId}`);
    }

    // Actualizar progreso
    job.progress(30);

    // Obtener todos los datos procesados
    const documentosData = await redisClient.hgetall(`vehiculo:${sessionId}:documentos`);
    if (!documentosData || Object.keys(documentosData).length === 0) {
      throw new Error('No se encontraron documentos procesados');
    }

    // Actualizar progreso
    job.progress(50);

    // Preparar objeto con actualizaciones
    const actualizaciones = {};

    // Recorrer los documentos procesados
    for (const [categoria, documento] of Object.entries(documentosData)) {
      let parsedDoc;
      try {
        parsedDoc = JSON.parse(documento);
      } catch (error) {
        logger.error(`Error al parsear datos de ${categoria}: ${error.message}`);
        throw new Error(`Error al parsear datos de ${categoria}`);
      }

      // Si es tarjeta de propiedad, actualizar datos básicos
      if (categoria === 'TARJETA_DE_PROPIEDAD') {
        // No permitir cambiar la placa
        if (parsedDoc.placa && parsedDoc.placa !== vehiculo.placa) {
          throw new Error(`No se puede cambiar la placa del vehículo. Actual: ${vehiculo.placa}, Nueva: ${parsedDoc.placa}`);
        }

        // Actualizar otros campos de la tarjeta si existen y son válidos
        const camposActualizables = ['marca', 'linea', 'modelo', 'color', 'servicio', 'clasevehiculo', 'tipocarroceria'];
        for (const campo of camposActualizables) {
          if (parsedDoc[campo] && parsedDoc[campo].toString().trim() !== '') {
            actualizaciones[campo] = parsedDoc[campo];
          }
        }
      }
      // Para otros documentos, actualizar fechas de vencimiento
      else if (mapeoFechas[categoria] && parsedDoc) {
        // Validar placa si existe
        if (parsedDoc.placa) {
          validarPlaca(parsedDoc.placa, vehiculo.placa, categoria);
        }

        // Añadir fecha de vencimiento si existe
        if (parsedDoc[mapeoFechas[categoria]]) {
          // Validar formato de fecha
          if (isValidDate(parsedDoc[mapeoFechas[categoria]])) {
            actualizaciones[mapeoFechas[categoria]] = parsedDoc[mapeoFechas[categoria]];

            // Actualizar estado de vigencia
            const hoy = new Date();
            if (new Date(parsedDoc[mapeoFechas[categoria]]) < hoy) {
              actualizaciones[`${mapeoFechas[categoria]}Estado`] = 'VENCIDO';
            } else {
              actualizaciones[`${mapeoFechas[categoria]}Estado`] = 'VIGENTE';
            }
          } else {
            logger.warn(`Formato de fecha inválido en ${categoria}: ${parsedDoc[mapeoFechas[categoria]]}`);
          }
        }
      }
    }

    // Actualizar progreso
    job.progress(70);

    // Verificar que haya algo para actualizar
    if (Object.keys(actualizaciones).length === 0) {
      logger.warn(`No hay campos para actualizar en el vehículo ${vehiculoId}`);
      throw new Error('No se encontraron datos válidos para actualizar el vehículo');
    }

    // Añadir fecha de actualización
    actualizaciones.fechaActualizacion = new Date();

    // Actualizar vehículo en la base de datos
    let vehiculoActualizado = null;
    let intentos = 0;
    const maxIntentos = 3;

    while (intentos < maxIntentos && !vehiculoActualizado) {
      try {
        // Actualizar vehículo en la base de datos
        await vehiculo.update(actualizaciones);
        vehiculoActualizado = await Vehiculo.findByPk(vehiculoId); // Recargar para obtener datos actualizados

        logger.info(`Vehículo con placa ${vehiculo.placa} actualizado. Sesión: ${sessionId}`);
        break;
      } catch (dbError) {
        intentos++;
        logger.error(`Error al actualizar vehículo en BD, intento ${intentos}/${maxIntentos}: ${dbError.message}`);
        if (intentos >= maxIntentos) {
          throw new Error(`Error al guardar en base de datos después de ${maxIntentos} intentos: ${dbError.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar 1 segundo antes de reintentar
      }
    }

    // ** BLOQUE MODIFICADO - Subir documentos a S3 con eliminación previa de documentos antiguos **
    try {
      logger.info(`Iniciando subida de documentos a S3 para vehículo: ${vehiculoActualizado.id}, sesión: ${sessionId}`);

      // Llamar a la función para subir los documentos, pasando true para indicar que es una actualización
      const documentosSubidos = await documentoController.uploadProcessedDocuments(
        sessionId, 
        vehiculoActualizado.id,
        true // Indicar que es una actualización para eliminar documentos antiguos
      );

      logger.info(`Subida de documentos completada. Total: ${documentosSubidos.length} documentos subidos para vehículo: ${vehiculoActualizado.id}`);

      // Actualizar información en Redis con los documentos subidos
      await redisClient.hmset(`vehiculo:${sessionId}`, {
        'estado': 'completado',
        'documentosSubidos': JSON.stringify(documentosSubidos.map(doc => ({
          id: doc.id,
          tipo: doc.document_type,
          s3Key: doc.s3_key
        }))),
        'fechaCompletado': new Date().toISOString()
      });
    } catch (uploadError) {
      // En caso de error en la subida de documentos, lo registramos pero continuamos
      logger.error(`Error al subir documentos a S3 para vehículo: ${vehiculoActualizado.id}: ${uploadError.message}`);

      // Actualizar estado en Redis indicando el problema
      await redisClient.hmset(`vehiculo:${sessionId}`, {
        'estado': 'completado_con_errores',
        'error_documentos': uploadError.message,
        'fechaCompletado': new Date().toISOString()
      });

      // Si quieres enviar una notificación específica sobre este error
      const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
      notificarCliente(socketId, 'error_documentos', {
        success: false,
        vehiculo: vehiculoActualizado,
        mensaje: 'Error al subir documentos del vehículo',
        error: uploadError.message
      });
    }

    // Actualizar progreso
    job.progress(90);

    // Crear resumen de documentos procesados
    const resumenDocumentos = Object.keys(documentosData).map(categoria => ({
      categoria,
      procesadoEn: new Date().toISOString()
    }));

    // Guardar la información del vehículo y el resumen en Redis
    await redisClient.hmset(`vehiculo:${sessionId}`, {
      'estado': 'completado',
      'vehiculoId': vehiculoId,
      'placa': vehiculo.placa,
      'fechaCompletado': new Date().toISOString(),
      'resumenDocumentos': JSON.stringify(resumenDocumentos)
    });

    // Notificar a través de WebSocket
    const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
    notificarCliente(socketId, 'vehiculo-actualizado', {
      success: true,
      vehiculo: vehiculoActualizado,
      mensaje: 'Vehículo actualizado exitosamente',
      detalles: {
        documentosProcesados: Object.keys(documentosData).length,
        fechaActualizacion: vehiculoActualizado.fechaActualizacion
      }
    });

    notificarGlobal('vehiculo_actualizado', {
      success: true,
      vehiculo: vehiculoActualizado,
      mensaje: 'Vehículo actualizado exitosamente',
      detalles: {
        documentosProcesados: Object.keys(documentosData).length,
        fechaCreacion: vehiculoActualizado.fechaCreacion
      }
    });

    // Liberar el bloqueo
    await redisClient.del(lockKey);

    // Actualizar progreso
    job.progress(100);

    logger.info(`Vehículo actualizado exitosamente. ID: ${vehiculoId}, Placa: ${vehiculo.placa}, Sesión: ${sessionId}`);
    return { success: true, vehiculo: vehiculoActualizado };
  } catch (error) {
    logger.error(`Error al actualizar vehículo: ${error.message}`, error);

    // Liberar el bloqueo si existe
    const lockKey = `lock:vehiculo:${sessionId}`;
    await redisClient.del(lockKey);

    // Marcar sesión como fallida
    await redisClient.hmset(`vehiculo:${sessionId}`, {
      'estado': 'fallido',
      'error': error.message,
      'fechaError': new Date().toISOString()
    });

    // Notificar error a través de WebSocket
    const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
    notificarCliente(socketId, 'error-procesamiento', {
      etapa: 'actualizacion-vehiculo',
      mensaje: error.message
    });

    throw error;
  }
});

// Exportar funciones y cola
module.exports = {
  vehicleCreationQueue,
  crearVehiculo,
  procesarDocumentos,
  actualizarDocumentosVehiculo
};