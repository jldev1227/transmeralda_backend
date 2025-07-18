// src/services/conductorQueueMinistral.js
const Queue = require('bull');
const { redisOptions } = require('../config/redisClient');
const logger = require('../utils/logger');
const { User, Conductor, Documento } = require('../models');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { uploadProcessedDocumentsConductor, saveTemporaryDocument } = require('../controllers/documentoController');
const fs = require('fs').promises;
const { redisClient } = require('../config/redisClient');
const axios = require('axios');
const FormData = require('form-data');
const eventEmitter = require('../utils/eventEmitter');
const { notificarGlobal, notifyUser } = require('../utils/notificar');
const { procesarDatosOCRConMinistral } = require('../services/ministralConductor');

// Configuración de las colas
const conductorCreacionQueueMinistral = new Queue('conductor-creacion-ministral', {
  redis: {
    host: redisOptions.host,
    port: redisOptions.port,
    password: redisOptions.password,
  },
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
    attempts: 1,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

const conductorActualizacionQueueMinistral = new Queue('conductor-actualizacion-ministral', {
  redis: {
    host: redisOptions.host,
    port: redisOptions.port,
    password: redisOptions.password,
  },
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
    attempts: 1,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Función para transformar fechas
const transformarFecha = (fechaString) => {
  if (!fechaString) return null;
  const partes = fechaString.split('/');
  if (partes.length === 3) {
    const [dia, mes, año] = partes;
    return `${año}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }
  return fechaString;
};

// Función para transformar licencias
const transformarLicencias = (licenciasArray, fechaExpedicion) => {
  if (!licenciasArray || !Array.isArray(licenciasArray)) {
    return null;
  }
  return {
    fecha_expedicion: transformarFecha(fechaExpedicion),
    categorias: licenciasArray.map(licencia => ({
      categoria: licencia.categoria,
      vigencia_hasta: transformarFecha(licencia.vigencia_hasta)
    }))
  };
};

// Función para esperar resultado OCR
async function waitForOcrResult(operationLocation, subscriptionKey) {
  let status = 'running';
  let result;
  let retries = 0;
  const maxRetries = 60;

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

// ✅ FUNCIÓN PARA EJECUTAR OCR (GLOBAL)
async function ejecutarOCR(archivo) {
  try {
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
    return ocrData;
  } catch (error) {
    logger.error(`Error en OCR: ${error.message}`);
    throw error;
  }
}

// ✅ FUNCIÓN PARA MANEJO DE ERRORES (GLOBAL)
async function handleProcessingError(userId, sessionId, socketId, errorMessage, errorType, tipoOperacion = 'creacion', conductor = null) {
  try {
    await redisClient.hmset(`conductor:${sessionId}`,
      'estado', 'error',
      'error', errorMessage,
      'error_tipo', errorType,
      'mensaje', 'Error al procesar conductor con IA',
      'fecha_error', new Date().toISOString()
    );

    notifyUser(userId, 'conductor:procesamiento:error', {
      sessionId,
      socketId,
      tipo: tipoOperacion,
      error: errorMessage,
      errorTipo: errorType,
      mensaje: 'Error al procesar conductor con IA',
      procesamiento: 'ministral',
      critico: true,
      ...(errorType.includes('validacion_identificacion_existente') && { conductor: conductor })
    });
  } catch (redisError) {
    logger.error(`Error al actualizar Redis con información de error: ${redisError.message}`);
  }
}

// ✅ FUNCIÓN PARA MANEJO DE ERRORES DE DOCUMENTOS (GLOBAL)
async function handleDocumentError(userId, sessionId, socketId, categoria, errorMessage, tipoOperacion = 'creacion') {
  try {
    await redisClient.hmset(`conductor:${sessionId}`,
      'estado', 'error',
      'error', `Error al procesar documento ${categoria}: ${errorMessage}`
    );

    await redisClient.hset(`conductor:${sessionId}`, `documento_${categoria}_error`, errorMessage);

    notifyUser(userId, 'conductor:procesamiento:error', {
      sessionId,
      socketId,
      tipo: tipoOperacion,
      error: `Error al procesar documento ${categoria}: ${errorMessage}`,
      errorTipo: 'documento_procesamiento',
      documento: categoria,
      mensaje: `Error al procesar documento ${categoria}`,
      procesamiento: 'ministral',
      critico: true
    });
  } catch (redisError) {
    logger.error(`Error al actualizar Redis con error de documento: ${redisError.message}`);
  }
}

// Función para inicializar procesadores
function inicializarProcesadoresConductorMinistral() {
  logger.info('Inicializando procesadores de colas de conductores con Ministral...');

  // ✅ PROCESADOR PARA CREACIÓN DE CONDUCTORES CON MINISTRAL
  conductorCreacionQueueMinistral.process('crear-conductor-ministral', async (job) => {
    const { sessionId, adaptedFiles, categorias, socketId } = job.data;
    const userId = job.opts.userId;

    try {
      // ====== PASO 1: INICIALIZACIÓN ======
      await redisClient.hmset(`conductor:${sessionId}`,
        'procesados', '0',
        'totalDocumentos', adaptedFiles.length.toString(),
        'progreso', '0',
        'estado', 'iniciando',
        'mensaje', 'Iniciando procesamiento con IA...',
        'procesamiento_tipo', 'ministral'
      );

      logger.info(`Iniciando procesamiento con Ministral: ${sessionId}`);
      notifyUser(userId, 'conductor:procesamiento:inicio', {
        sessionId,
        socketId,
        tipo: 'creacion',
        estado: 'iniciando',
        mensaje: 'Iniciando procesamiento con IA...',
        progreso: 0,
        procesamiento: 'ministral'
      });

      // Validar documentos obligatorios
      const categoriasObligatorias = ["CEDULA", "LICENCIA", "CONTRATO"];
      const categoriasFaltantes = categoriasObligatorias.filter(
        (categoria) => !categorias.includes(categoria)
      );

      if (categoriasFaltantes.length > 0) {
        const errorMsg = `Faltan los siguientes documentos obligatorios: ${categoriasFaltantes.join(', ')}.`;
        await handleProcessingError(userId, sessionId, socketId, errorMsg, 'validacion_documentos_faltantes');
        throw new Error(errorMsg);
      }

      // ====== PASO 2: PROCESAR DOCUMENTOS CON OCR ======
      job.progress(20);
      await redisClient.hmset(`conductor:${sessionId}`,
        'progreso', '20',
        'estado', 'procesando_ocr',
        'mensaje', 'Extrayendo información de documentos...'
      );

      notifyUser(userId, 'conductor:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Extrayendo información de documentos...',
        progreso: 20
      });

      const datosDocumentos = {};

      // Procesar cada documento
      for (let i = 0; i < adaptedFiles.length; i++) {
        const archivo = adaptedFiles[i];
        const progresoActual = 20 + ((i + 1) / adaptedFiles.length) * 30; // 20% - 50%

        await redisClient.hmset(`conductor:${sessionId}`,
          'procesados', (i + 1).toString(),
          'progreso', Math.round(progresoActual).toString(),
          'mensaje', `Procesando ${archivo.categoria} (${i + 1}/${adaptedFiles.length})...`,
          'documento_actual', archivo.categoria
        );

        notifyUser(userId, 'conductor:procesamiento:progreso', {
          sessionId,
          socketId,
          mensaje: `Procesando ${archivo.categoria} (${i + 1}/${adaptedFiles.length})...`,
          progreso: Math.round(progresoActual)
        });

        try {
          // Guardar documento temporalmente
          const fileInfo = await saveTemporaryDocument(archivo, sessionId, archivo.categoria);
          await redisClient.set(
            `conductor:${sessionId}:files:${archivo.categoria}`,
            JSON.stringify(fileInfo),
            'EX', 3600
          );

          // Ejecutar OCR
          const ocrData = await ejecutarOCR(archivo);

          // Almacenar datos OCR en Redis
          await redisClient.set(
            `conductor:${sessionId}:ocr:${archivo.categoria}`,
            JSON.stringify(ocrData),
            'EX', 3600
          );

          // Almacenar en el objeto de datos
          datosDocumentos[archivo.categoria] = ocrData;
          logger.info(`OCR completado para ${archivo.categoria}`);
        } catch (error) {
          logger.error(`Error procesando documento ${archivo.categoria}: ${error.message}`);
          await handleDocumentError(userId, sessionId, socketId, archivo.categoria, error.message);
          throw error;
        }
      }

      // ====== PASO 3: PROCESAR CON MINISTRAL ======
      job.progress(50);
      await redisClient.hmset(`conductor:${sessionId}`,
        'progreso', '50',
        'estado', 'procesando_ia',
        'mensaje', 'Procesando datos con Inteligencia Artificial...'
      );

      notifyUser(userId, 'conductor:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Procesando datos con Inteligencia Artificial...',
        progreso: 50
      });

      const datosEstructurados = {};

      // Procesar cada documento con Ministral
      for (const categoria of categorias) {
        if (datosDocumentos[categoria]) {
          try {
            if (categoria === 'FOTO_PERFIL') {
              console.log('⚠️ Saltando procesamiento de FOTO_PERFIL temporalmente');
              datosEstructurados[categoria] = null; // o datos por defecto
              continue;
            }

            const datosMinistral = await procesarDatosOCRConMinistral(
              datosDocumentos[categoria],
              categoria
            );

            datosEstructurados[categoria] = datosMinistral;

            // Almacenar resultado de Ministral
            await redisClient.set(
              `conductor:${sessionId}:ministral:${categoria}`,
              JSON.stringify(datosMinistral),
              'EX', 3600
            );

            logger.info(`Ministral procesó exitosamente ${categoria}:`, datosMinistral);
          } catch (error) {
            logger.error(`Error procesando ${categoria} con Ministral: ${error.message}`);
            throw new Error(`Error en IA para ${categoria}: ${error.message}`);
          }
        }
      }

      // ====== PASO 4: COMBINAR DATOS DE TODOS LOS DOCUMENTOS ======
      job.progress(70);
      await redisClient.hmset(`conductor:${sessionId}`,
        'progreso', '70',
        'estado', 'combinando_datos',
        'mensaje', 'Combinando información de todos los documentos...'
      );

      notifyUser(userId, 'conductor:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Combinando información de todos los documentos...',
        progreso: 70
      });

      // Combinar datos usando Ministral
      const { MinistralConductorService } = require('../services/ministralConductor');
      const ministralService = new MinistralConductorService();
      const datosFinales = await ministralService.combinarDatosDocumentos(datosEstructurados);

      console.log('Datos finales combinados:', datosFinales);

      // Validar campos obligatorios
      const camposObligatorios = ['nombre', 'apellido', 'numero_identificacion', 'genero'];
      const camposFaltantes = camposObligatorios.filter(campo =>
        !datosFinales[campo] || datosFinales[campo].toString().trim() === ''
      );

      if (camposFaltantes.length > 0) {
        const errorMsg = `Faltan los siguientes campos obligatorios: ${camposFaltantes.join(', ')}`;
        await handleProcessingError(userId, sessionId, socketId, errorMsg, 'validacion_campos_obligatorios');
        throw new Error(errorMsg);
      }

      // ====== PASO 5: VERIFICAR DUPLICADOS ======
      job.progress(75);
      await redisClient.hmset(`conductor:${sessionId}`,
        'progreso', '75',
        'estado', 'verificando_duplicados',
        'mensaje', 'Verificando duplicados...'
      );

      notifyUser(userId, 'conductor:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Verificando duplicados...',
        progreso: 75
      });

      const conductorExistente = await Conductor.findOne({
        where: { numero_identificacion: datosFinales.numero_identificacion }
      });

      if (conductorExistente) {
        const errorMsg = `Ya existe un conductor con esa identificación ${datosFinales.numero_identificacion}`;
        logger.error(errorMsg);
        await handleProcessingError(userId, sessionId, socketId, errorMsg, 'validacion_identificacion_existente', conductorExistente);
        throw new Error(errorMsg);
      }

      // ====== PASO 6: ACTUALIZAR ESTADO COMO COMPLETADO ======
      job.progress(80);
      await redisClient.hmset(`conductor:${sessionId}`,
        'progreso', '80',
        'estado', 'completado',
        'mensaje', 'Datos procesados exitosamente con IA. Registrando conductor...'
      );

      notifyUser(userId, 'conductor:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Datos procesados exitosamente con IA. Registrando conductor...',
        progreso: 80,
        datosConductor: datosFinales,
        procesamiento: 'ministral'
      });

      logger.info(`Datos procesados exitosamente con IA para conductor: ${datosFinales.numero_identificacion}`);

      // ====== PASO 7: CREAR CONDUCTOR AUTOMÁTICAMENTE ======
      job.progress(85);
      await redisClient.hmset(`conductor:${sessionId}`,
        'progreso', '85',
        'estado', 'creando_conductor',
        'mensaje', 'Creando conductor en la base de datos...'
      );

      notifyUser(userId, 'conductor:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Creando conductor en la base de datos...',
        progreso: 85
      });

      // Preparar datos para la base de datos
      const datosParaBD = {
        ...datosFinales,
        fecha_ingreso: transformarFecha(datosFinales.fecha_ingreso),
        fecha_nacimiento: transformarFecha(datosFinales.fecha_nacimiento),
        licencia_conduccion: transformarLicencias(
          datosFinales.licencia_conduccion?.categorias,
          datosFinales.licencia_conduccion?.fecha_expedicion
        ),
        estado: 'disponible'
      };

      console.log('Datos para BD:', datosParaBD);
      const nuevoConductor = await Conductor.create(datosParaBD, {
        user_id: userId // ID del usuario autenticado
      });
      logger.info(`Conductor creado automáticamente con ID: ${nuevoConductor.id} usando Ministral`);

      // ====== PASO 8: SUBIR DOCUMENTOS ======
      job.progress(95);
      await redisClient.hmset(`conductor:${sessionId}`,
        'progreso', '95',
        'mensaje', 'Subiendo documentos al almacenamiento...'
      );

      notifyUser(userId, 'conductor:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Subiendo documentos al almacenamiento...',
        progreso: 95
      });

      const documentosCreados = await uploadProcessedDocumentsConductor(
        sessionId,
        nuevoConductor.id,
        [],
        false
      );

      // ====== FINALIZACIÓN AUTOMÁTICA ======
      job.progress(100);
      await redisClient.hmset(`conductor:${sessionId}`,
        'progreso', '100',
        'estado', 'completado',
        'mensaje', 'Conductor registrado exitosamente con IA',
        'documentos_creados', documentosCreados.length.toString(),
        'fecha_completado', new Date().toISOString(),
        'procesamiento_completado', 'ministral'
      );

      notifyUser(userId, 'conductor:procesamiento:completado', {
        sessionId,
        socketId,
        tipo: 'actualizacion',
        conductor: conductorActualizado,
        documentos: documentosCreados,
        mensaje: 'Conductor actualizado exitosamente con IA',
        progreso: 100,
        procesamiento: 'ministral',
        datosIA: datosNuevosExtracted,
        actualizacionAutomatica: true
      });

      notifyUser(userId, 'conductor:actualizado', {
        conductor: conductorActualizado,
        documentos: documentosCreados,
        procesamiento: 'ministral'
      });

      const { id, nombre } = await User.findByPk(userId);
      notificarGlobal('conductor:actualizado-global', {
        usuarioId: id,
        usuarioNombre: nombre,
        conductor: conductorActualizado,
        documentos: documentosCreados,
        procesamiento: 'ministral'
      });

      logger.info(`Actualización automática de conductor completada exitosamente con Ministral: ${sessionId}`);
      return { conductor: conductorActualizado, documentos: documentosCreados };

    } catch (error) {
      logger.error(`Error en actualización con Ministral ${sessionId}: ${error.message}`);
      await handleProcessingError(userId, sessionId, socketId, error.message, 'general');

      // Limpiar archivos temporales
      try {
        const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);
        // await fs.rm(tempDir, { recursive: true, force: true });
        logger.info(`Directorio temporal limpiado para sesión ${sessionId}`);
      } catch (cleanupError) {
        logger.warn(`Error al limpiar directorio temporal: ${cleanupError.message}`);
      }

      throw error;
    } finally {
      await redisClient.expire(`conductor:${sessionId}`, 86400);
    }
  });

  // Eventos de monitoreo para creación
  conductorCreacionQueueMinistral.on('completed', (job, result) => {
    logger.info(`Job de creación con Ministral completado automáticamente: ${job.id}`);
  });

  conductorCreacionQueueMinistral.on('failed', (job, err) => {
    logger.error(`Job de creación con Ministral falló: ${job.id} - ${err.message}`);
  });

  conductorCreacionQueueMinistral.on('stalled', (job) => {
    logger.warn(`Job de creación con Ministral estancado: ${job.id}`);
  });

  // Eventos de monitoreo para actualización
  conductorActualizacionQueueMinistral.on('completed', (job, result) => {
    logger.info(`Job de actualización con Ministral completado automáticamente: ${job.id}`);
  });

  conductorActualizacionQueueMinistral.on('failed', (job, err) => {
    logger.error(`Job de actualización con Ministral falló: ${job.id} - ${err.message}`);
  });

  conductorActualizacionQueueMinistral.on('stalled', (job) => {
    logger.warn(`Job de actualización con Ministral estancado: ${job.id}`);
  });

  logger.info('Procesadores de colas de conductores con Ministral inicializados correctamente (creación y actualización)');
}

// Función para procesar documentos con Ministral (creación)
async function procesarDocumentosConMinistral(userId, adaptedFiles, categorias, socketId) {
  const sessionId = uuidv4();
  const jobData = {
    sessionId,
    adaptedFiles,
    categorias,
    socketId,
    timestamp: new Date().toISOString()
  };

  logger.info(`Usuario que solicita creación automática con Ministral: ${userId}`);

  try {
    await conductorCreacionQueueMinistral.add('crear-conductor-ministral', jobData, {
      jobId: sessionId,
      userId,
      priority: 10
    });

    logger.info(`Job de creación automática de conductor con Ministral encolado: ${sessionId}`);
    return sessionId;
  } catch (error) {
    logger.error(`Error al encolar job de creación automática con Ministral: ${error.message}`);
    throw error;
  }
}

// ✅ NUEVA FUNCIÓN para procesar documentos con Ministral (actualización)
async function actualizarDocumentosConMinistral(userId, conductorId, adaptedFiles, categorias, socketId, datosBasicos = {}) {
  const sessionId = uuidv4();
  const jobData = {
    sessionId,
    conductorId,
    adaptedFiles,
    categorias,
    socketId,
    datosBasicos,
    timestamp: new Date().toISOString()
  };

  logger.info(`Usuario que solicita actualización automática con Ministral: ${userId} para conductor: ${conductorId}`);

  try {
    await conductorActualizacionQueueMinistral.add('actualizar-conductor-ministral', jobData, {
      jobId: sessionId,
      userId,
      priority: 5 // Prioridad menor que creación
    });

    logger.info(`Job de actualización automática de conductor con Ministral encolado: ${sessionId}`);
    return sessionId;
  } catch (error) {
    logger.error(`Error al encolar job de actualización automática con Ministral: ${error.message}`);
    throw error;
  }
}

// ✅ PROCESADOR PARA ACTUALIZACIÓN DE CONDUCTORES CON MINISTRAL
conductorActualizacionQueueMinistral.process('actualizar-conductor-ministral', async (job) => {
  const { sessionId, conductorId, adaptedFiles, categorias, socketId, datosBasicos } = job.data;
  const userId = job.opts.userId;

  try {
    // ====== PASO 1: INICIALIZACIÓN ======
    await redisClient.hmset(`conductor:${sessionId}`,
      'procesados', '0',
      'totalDocumentos', adaptedFiles.length.toString(),
      'progreso', '0',
      'estado', 'iniciando',
      'mensaje', 'Iniciando actualización con IA...',
      'procesamiento_tipo', 'ministral',
      'conductor_id', conductorId
    );

    logger.info(`Iniciando actualización con Ministral: ${sessionId} para conductor: ${conductorId}`);
    notifyUser(userId, 'conductor:procesamiento:inicio', {
      sessionId,
      socketId,
      tipo: 'actualizacion',
      conductorId,
      estado: 'iniciando',
      mensaje: 'Iniciando actualización con IA...',
      progreso: 0,
      procesamiento: 'ministral'
    });

    // Verificar que el conductor existe
    const conductorExistente = await Conductor.findByPk(conductorId, {
      include: [{ model: Documento, as: 'documentos' }]
    });

    if (!conductorExistente) {
      const errorMsg = `Conductor con ID ${conductorId} no encontrado`;
      await handleProcessingError(userId, sessionId, socketId, errorMsg, 'conductor_no_encontrado');
      throw new Error(errorMsg);
    }

    // ====== PASO 2: PROCESAR DOCUMENTOS NUEVOS CON OCR ======
    job.progress(20);
    await redisClient.hmset(`conductor:${sessionId}`,
      'progreso', '20',
      'estado', 'procesando_ocr',
      'mensaje', 'Extrayendo información de documentos nuevos...'
    );

    notifyUser(userId, 'conductor:procesamiento:progreso', {
      sessionId,
      socketId,
      mensaje: 'Extrayendo información de documentos nuevos...',
      progreso: 20
    });

    const datosDocumentos = {};

    // Procesar solo documentos nuevos
    for (let i = 0; i < adaptedFiles.length; i++) {
      const archivo = adaptedFiles[i];
      const progresoActual = 20 + ((i + 1) / adaptedFiles.length) * 25; // 20% - 45%

      await redisClient.hmset(`conductor:${sessionId}`,
        'procesados', (i + 1).toString(),
        'progreso', Math.round(progresoActual).toString(),
        'mensaje', `Procesando ${archivo.categoria} (${i + 1}/${adaptedFiles.length})...`,
        'documento_actual', archivo.categoria
      );

      notifyUser(userId, 'conductor:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: `Procesando ${archivo.categoria} (${i + 1}/${adaptedFiles.length})...`,
        progreso: Math.round(progresoActual)
      });

      try {
        // Guardar documento temporalmente
        const fileInfo = await saveTemporaryDocument(archivo, sessionId, archivo.categoria);
        await redisClient.set(
          `conductor:${sessionId}:files:${archivo.categoria}`,
          JSON.stringify(fileInfo),
          'EX', 3600
        );

        // Ejecutar OCR
        const ocrData = await ejecutarOCR(archivo);

        // Almacenar datos OCR en Redis
        await redisClient.set(
          `conductor:${sessionId}:ocr:${archivo.categoria}`,
          JSON.stringify(ocrData),
          'EX', 3600
        );

        // Almacenar en el objeto de datos
        datosDocumentos[archivo.categoria] = ocrData;
        logger.info(`OCR completado para ${archivo.categoria} (actualización)`);
      } catch (error) {
        logger.error(`Error procesando documento ${archivo.categoria}: ${error.message}`);
        await handleDocumentError(userId, sessionId, socketId, archivo.categoria, error.message);
        throw error;
      }
    }

    // ====== PASO 3: PROCESAR CON MINISTRAL (VERSIÓN MEJORADA) ======
    job.progress(45);
    await redisClient.hmset(`conductor:${sessionId}`,
      'progreso', '45',
      'estado', 'procesando_ia',
      'mensaje', 'Procesando nuevos datos con Inteligencia Artificial...'
    );

    notifyUser(userId, 'conductor:procesamiento:progreso', {
      sessionId,
      socketId,
      mensaje: 'Procesando nuevos datos con Inteligencia Artificial...',
      progreso: 45
    });

    const datosEstructurados = {};

    // ✅ PROCESAR CADA DOCUMENTO NUEVO CON MINISTRAL DE FORMA INTELIGENTE
    for (const categoria of categorias) {
      if (datosDocumentos[categoria]) {
        try {
          if (categoria === 'FOTO_PERFIL') {
            // ✅ MANEJO ESPECÍFICO PARA FOTO_PERFIL
            logger.info(`📸 Procesando FOTO_PERFIL - no se extraerán datos, solo se almacenará`);
            datosEstructurados[categoria] = {
              categoria: 'FOTO_PERFIL',
              procesado: true,
              mensaje: 'Foto de perfil procesada exitosamente',
              archivo_guardado: true,
              extraccion_datos: false // No se extraen datos de la foto
            };

            // Almacenar en Redis para referencia
            await redisClient.set(
              `conductor:${sessionId}:ministral:${categoria}`,
              JSON.stringify(datosEstructurados[categoria]),
              'EX', 3600
            );

            logger.info(`✅ FOTO_PERFIL procesada exitosamente - no requiere análisis de IA`);
            continue;
          }

          // ✅ PROCESAR OTROS DOCUMENTOS CON MINISTRAL NORMALMENTE
          logger.info(`🤖 Procesando ${categoria} con IA para extraer datos...`);
          const datosMinistral = await procesarDatosOCRConMinistral(
            datosDocumentos[categoria],
            categoria
          );

          datosEstructurados[categoria] = datosMinistral;

          // Almacenar resultado de Ministral
          await redisClient.set(
            `conductor:${sessionId}:ministral:${categoria}`,
            JSON.stringify(datosMinistral),
            'EX', 3600
          );

          logger.info(`✅ Ministral procesó exitosamente ${categoria} para actualización:`, datosMinistral);
        } catch (error) {
          logger.error(`❌ Error procesando ${categoria} con Ministral: ${error.message}`);
          throw new Error(`Error en IA para ${categoria}: ${error.message}`);
        }
      }
    }

    // ✅ VERIFICAR SI HAY DATOS PARA COMBINAR
    const categoriesWithData = Object.keys(datosEstructurados).filter(cat =>
      datosEstructurados[cat] && cat !== 'FOTO_PERFIL'
    );

    logger.info(`📊 Categorías con datos para combinar: ${categoriesWithData.join(', ')}`);
    logger.info(`📋 Total de categorías procesadas: ${Object.keys(datosEstructurados).length}`);

    job.progress(65);
    await redisClient.hmset(`conductor:${sessionId}`,
      'progreso', '65',
      'estado', 'combinando_datos',
      'mensaje', 'Combinando datos existentes con información nueva...'
    );

    notifyUser(userId, 'conductor:procesamiento:progreso', {
      sessionId,
      socketId,
      mensaje: 'Combinando datos existentes con información nueva...',
      progreso: 65
    });

    // Obtener datos actuales del conductor
    const datosActuales = conductorExistente.toJSON();

    let datosNuevosExtracted = {};

    // ✅ SOLO COMBINAR DATOS SI HAY DOCUMENTOS QUE EXTRAIGAN INFORMACIÓN
    if (categoriesWithData.length > 0) {
      logger.info(`🔄 Combinando datos de documentos: ${categoriesWithData.join(', ')}`);

      // Filtrar solo los documentos que tienen datos para extraer
      const datosParaCombinar = {};
      categoriesWithData.forEach(cat => {
        datosParaCombinar[cat] = datosEstructurados[cat];
      });

      // Combinar datos usando Ministral
      const { MinistralConductorService } = require('../services/ministralConductor');
      const ministralService = new MinistralConductorService();

      datosNuevosExtracted = await ministralService.combinarDatosDocumentos(datosParaCombinar);
      logger.info(`✅ Datos combinados exitosamente:`, datosNuevosExtracted);
    } else {
      logger.info(`ℹ️ No hay documentos con datos para combinar (solo FOTO_PERFIL o documentos sin extracción)`);
      datosNuevosExtracted = {}; // Objeto vacío si solo es foto de perfil
    }

    // ✅ FUSIONAR CON DATOS EXISTENTES
    const datosFinales = {
      ...datosActuales,
      ...datosBasicos, // Datos básicos del formulario si los hay
      ...datosNuevosExtracted // Datos extraídos de documentos nuevos (tienen prioridad)
    };

    // Conservar el ID y campos críticos
    datosFinales.id = conductorId;
    datosFinales.numero_identificacion = datosActuales.numero_identificacion; // No cambiar identificación

    logger.info(`📝 Datos finales para actualización:`, {
      categoriasConDatos: categoriesWithData,
      soloFotoPerfil: categorias.length === 1 && categorias.includes('FOTO_PERFIL'),
      camposActualizados: Object.keys(datosNuevosExtracted),
      totalCampos: Object.keys(datosFinales).length
    });

    console.log('Datos finales para actualización:', datosFinales);

    // ====== PASO 5: VALIDAR CAMPOS CRÍTICOS (VERSIÓN CORREGIDA) ======
    job.progress(75);
    await redisClient.hmset(`conductor:${sessionId}`,
      'progreso', '75',
      'estado', 'validando_datos',
      'mensaje', 'Validando datos actualizados...'
    );

    notifyUser(userId, 'conductor:procesamiento:progreso', {
      sessionId,
      socketId,
      mensaje: 'Validando datos actualizados...',
      progreso: 75
    });

    // ✅ VALIDACIÓN INTELIGENTE BASADA EN CATEGORÍAS DE DOCUMENTOS
    const categoriasQueExtraenDatos = ['CEDULA', 'LICENCIA', 'CONTRATO'];
    const categoriasEnProcesamiento = categorias.filter(cat => categoriasQueExtraenDatos.includes(cat));
    const soloFotoPerfil = categorias.length === 1 && categorias.includes('FOTO_PERFIL');

    // ✅ SOLO VALIDAR CAMPOS CRÍTICOS SI SE PROCESARON DOCUMENTOS QUE EXTRAEN DATOS
    if (categoriasEnProcesamiento.length > 0) {
      logger.info(`Validando campos críticos porque se procesaron documentos que extraen datos: ${categoriasEnProcesamiento.join(', ')}`);

      // Validar que no se pierdan campos críticos solo si se extrajeron datos de documentos importantes
      const camposCriticos = ['nombre', 'apellido', 'numero_identificacion'];
      const camposFaltantes = camposCriticos.filter(campo =>
        !datosFinales[campo] || datosFinales[campo].toString().trim() === ''
      );

      if (camposFaltantes.length > 0) {
        const errorMsg = `Faltan los siguientes campos críticos después de procesar ${categoriasEnProcesamiento.join(', ')}: ${camposFaltantes.join(', ')}`;
        await handleProcessingError(userId, sessionId, socketId, errorMsg, 'validacion_campos_criticos', 'actualizacion');
        throw new Error(errorMsg);
      }

      logger.info(`✅ Validación de campos críticos completada exitosamente`);
    } else if (soloFotoPerfil) {
      logger.info(`⚠️ Solo se está actualizando FOTO_PERFIL, saltando validación de campos críticos`);
    } else {
      logger.info(`ℹ️ No se procesaron documentos que requieran validación de campos críticos`);
    }

    // ====== PASO 6: ACTUALIZAR CONDUCTOR EN BD ======
    job.progress(85);
    await redisClient.hmset(`conductor:${sessionId}`,
      'progreso', '85',
      'estado', 'actualizando_conductor',
      'mensaje', 'Actualizando conductor en la base de datos...'
    );

    notifyUser(userId, 'conductor:procesamiento:progreso', {
      sessionId,
      socketId,
      mensaje: 'Actualizando conductor en la base de datos...',
      progreso: 85
    });

    // Preparar datos para la base de datos
    const datosParaBD = {
      ...datosFinales,
      fecha_ingreso: datosFinales.fecha_ingreso ? transformarFecha(datosFinales.fecha_ingreso) : datosActuales.fecha_ingreso,
      fecha_nacimiento: datosFinales.fecha_nacimiento ? transformarFecha(datosFinales.fecha_nacimiento) : datosActuales.fecha_nacimiento,
      licencia_conduccion: datosFinales.licencia_conduccion?.categorias
        ? transformarLicencias(datosFinales.licencia_conduccion.categorias, datosFinales.licencia_conduccion.fecha_expedicion)
        : datosActuales.licencia_conduccion,
    };

    // Remover campos que no deben actualizarse
    delete datosParaBD.id;
    delete datosParaBD.createdAt;
    delete datosParaBD.updatedAt;
    delete datosParaBD.documentos;

    await conductorExistente.update(datosParaBD, {
      user_id: userId // ID del usuario autenticado
    });
    const conductorActualizado = await Conductor.findByPk(conductorId, {
      include: [{ model: Documento, as: 'documentos' }]
    });

    logger.info(`Conductor actualizado exitosamente con ID: ${conductorId} usando Ministral`);

    // ====== PASO 7: SUBIR DOCUMENTOS NUEVOS ======
    job.progress(95);
    await redisClient.hmset(`conductor:${sessionId}`,
      'progreso', '95',
      'mensaje', 'Subiendo documentos nuevos al almacenamiento...'
    );

    notifyUser(userId, 'conductor:procesamiento:progreso', {
      sessionId,
      socketId,
      mensaje: 'Subiendo documentos nuevos al almacenamiento...',
      progreso: 95
    });

    const documentosCreados = await uploadProcessedDocumentsConductor(
      sessionId,
      conductorId,
      [],
      true, // Es actualización,
      categorias
    );

    // ====== FINALIZACIÓN ======
    job.progress(100);
    await redisClient.hmset(`conductor:${sessionId}`,
      'progreso', '100',
      'estado', 'completado',
      'mensaje', 'Conductor actualizado exitosamente con IA',
      'documentos_creados', documentosCreados.length.toString(),
      'fecha_completado', new Date().toISOString(),
      'procesamiento_completado', 'ministral'
    );

    // ✅ NOTIFICACIÓN ÚNICA DE PROCESAMIENTO COMPLETADO
    notifyUser(userId, 'conductor:procesamiento:completado', {
      sessionId,
      socketId,
      tipo: 'actualizacion',
      conductor: conductorActualizado,
      documentos: documentosCreados,
      mensaje: 'Conductor actualizado exitosamente con IA',
      progreso: 100,
      procesamiento: 'ministral',
      datosIA: datosNuevosExtracted,
      actualizacionAutomatica: true
    });

    // ✅ NOTIFICACIÓN ESPECÍFICA DE CONDUCTOR ACTUALIZADO
    notifyUser(userId, 'conductor:actualizado', {
      conductor: conductorActualizado,
      documentos: documentosCreados,
      procesamiento: 'ministral'
    });

    // ✅ NOTIFICACIÓN GLOBAL
    const { id, nombre } = await User.findByPk(userId);
    notificarGlobal('conductor:actualizado-global', {
      usuarioId: id,
      usuarioNombre: nombre,
      conductor: conductorActualizado,
      documentos: documentosCreados,
      procesamiento: 'ministral'
    });

    logger.info(`Actualización automática de conductor completada exitosamente con Ministral: ${sessionId}`);
    return { conductor: conductorActualizado, documentos: documentosCreados };

  } catch (error) {
    logger.error(`Error en actualización con Ministral ${sessionId}: ${error.message}`);
    await handleProcessingError(userId, sessionId, socketId, error.message, 'general');

    // Limpiar archivos temporales
    try {
      const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);
      // await fs.rm(tempDir, { recursive: true, force: true });
      logger.info(`Directorio temporal limpiado para sesión ${sessionId}`);
    } catch (cleanupError) {
      logger.warn(`Error al limpiar directorio temporal: ${cleanupError.message}`);
    }

    throw error;
  }
});

module.exports = {
  conductorCreacionQueueMinistral,
  conductorActualizacionQueueMinistral,
  procesarDocumentosConMinistral,
  actualizarDocumentosConMinistral, // ✅ Nueva función exportada
  inicializarProcesadoresConductorMinistral
};


