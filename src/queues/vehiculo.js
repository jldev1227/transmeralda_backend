const Queue = require('bull');
const { redisOptions } = require('../config/redisClient');
const logger = require('../utils/logger');
const { Vehiculo } = require('../models');
const Documento = require('../models/Documento');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;

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

// Función para inicializar los procesadores (debe ser llamada al iniciar la app)
function inicializarProcesadores() {
  logger.info('Inicializando procesadores de colas de vehículos...');

  // Procesador para creación de vehículos
  vehiculoCreacionQueue.process('crear-vehiculo', async (job) => {
    const { sessionId, adaptedFiles, categorias, datosVehiculo, socketId } = job.data;

    try {
      logger.info(`Iniciando procesamiento de creación de vehículo: ${sessionId}`);

      // Notificar inicio del procesamiento
      notificarGlobal('vehiculo:procesamiento:inicio', {
        sessionId,
        socketId,
        tipo: 'creacion',
        mensaje: 'Iniciando procesamiento de documentos...',
        progreso: 0
      });

      // Paso 1: Validar datos del vehículo
      job.progress(10);
      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Validando datos del vehículo...',
        progreso: 10
      });

      // Verificar si la placa ya existe (Sequelize syntax)
      const vehiculoExistente = await Vehiculo.findOne({
        where: { placa: datosVehiculo.placa }
      });

      if (vehiculoExistente) {
        throw new Error(`Ya existe un vehículo con la placa ${datosVehiculo.placa}`);
      }

      // Validar documentos obligatorios
      const categoriasObligatorias = ["TARJETA_DE_PROPIEDAD"];
      const categoriasFaltantes = categoriasObligatorias.filter(
        (categoria) => !categorias.includes(categoria)
      );

      if (categoriasFaltantes.length > 0) {
        throw new Error(`Falta la tarjeta de propiedad, que es obligatoria.`);
      }

      // Validar que el número de archivos coincida con las categorías
      if (adaptedFiles.length !== categorias.length) {
        throw new Error(`El número de archivos (${adaptedFiles.length}) no coincide con el número de categorías (${categorias.length})`);
      }

      // Paso 2: Crear el vehículo
      job.progress(20);
      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Creando registro del vehículo...',
        progreso: 20
      });

      const nuevoVehiculo = await Vehiculo.create({
        ...datosVehiculo,
        estado: 'DISPONIBLE'
      });

      logger.info(`Vehículo creado con ID: ${nuevoVehiculo.id}`);

      // Paso 3: Procesar documentos
      job.progress(30);
      const documentosCreados = [];
      const totalArchivos = adaptedFiles.length;

      for (let i = 0; i < adaptedFiles.length; i++) {
        const archivo = adaptedFiles[i];
        const progreso = 30 + ((i + 1) / totalArchivos) * 60; // De 30% a 90%

        job.progress(progreso);
        notificarGlobal('vehiculo:procesamiento:progreso', {
          sessionId,
          socketId,
          mensaje: `Procesando documento ${archivo.categoria} (${i + 1}/${totalArchivos})...`,
          progreso: Math.round(progreso)
        });

        try {
          // Validar que el archivo tenga buffer
          if (!archivo.buffer || !Buffer.isBuffer(archivo.buffer)) {
            throw new Error(`Buffer inválido para documento ${archivo.categoria}`);
          }

          // Generar nombre único para el archivo
          const extension = path.extname(archivo.filename);
          const nombreArchivo = `${nuevoVehiculo.id}_${archivo.categoria}_${Date.now()}${extension}`;
          const rutaArchivo = path.join(process.env.UPLOAD_PATH || './uploads', nombreArchivo);

          // Crear directorio si no existe
          const directorioUploads = path.dirname(rutaArchivo);
          await fs.mkdir(directorioUploads, { recursive: true });

          // Guardar archivo físico
          await fs.writeFile(rutaArchivo, archivo.buffer);

          // Crear registro de documento
          const nuevoDocumento = await Documento.create({
            vehiculoId: nuevoVehiculo.id,
            categoria: archivo.categoria,
            nombreOriginal: archivo.filename,
            nombreArchivo,
            rutaArchivo,
            mimetype: archivo.mimetype,
            tamaño: archivo.buffer.length,
            fechaVigencia: datosVehiculo.fechasVigencia?.[archivo.categoria] || null,
            estado: 'ACTIVO',
            fechaSubida: new Date()
          });

          documentosCreados.push(nuevoDocumento);

          logger.info(`Documento ${archivo.categoria} procesado para vehículo ${nuevoVehiculo.id}`);
        } catch (error) {
          logger.error(`Error procesando documento ${archivo.categoria}: ${error.message}`);
          // Si falla un documento, eliminar el vehículo creado
          await Vehiculo.destroy({ where: { id: nuevoVehiculo.id } });
          throw new Error(`Error al procesar documento ${archivo.categoria}: ${error.message}`);
        }
      }

      // Paso 4: Finalizar
      job.progress(100);
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

    } catch (error) {
      logger.error(`Error en procesamiento de creación ${sessionId}: ${error.message}`);

      notificarGlobal('vehiculo:procesamiento:error', {
        sessionId,
        socketId,
        tipo: 'creacion',
        error: error.message,
        mensaje: 'Error al crear el vehículo'
      });

      throw error;
    }
  });

  // Procesador para actualización de documentos - MOVER DENTRO DE inicializarProcesadores
  vehiculoActualizacionQueue.process('actualizar-documentos-vehiculo', async (job) => {
    const { sessionId, adaptedFiles, categorias, fechasVigencia, vehiculoId, socketId } = job.data;

    try {
      logger.info(`Iniciando actualización de documentos: ${sessionId} para vehículo ${vehiculoId}`);

      // Notificar inicio del procesamiento
      notificarGlobal('vehiculo:procesamiento:inicio', {
        sessionId,
        socketId,
        tipo: 'actualizacion',
        vehiculoId,
        mensaje: 'Iniciando actualización de documentos...',
        progreso: 0
      });

      // Paso 1: Verificar que el vehículo existe
      job.progress(10);
      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Verificando vehículo...',
        progreso: 10
      });

      const vehiculo = await Vehiculo.findByPk(vehiculoId);
      if (!vehiculo) {
        throw new Error(`No se encontró el vehículo con ID: ${vehiculoId}`);
      }

      // Paso 2: Desactivar documentos anteriores de las categorías que se van a actualizar
      job.progress(20);
      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Actualizando documentos anteriores...',
        progreso: 20
      });

      await Documento.update(
        {
          estado: 'REEMPLAZADO',
          fechaReemplazo: new Date()
        },
        {
          where: {
            vehiculoId: vehiculoId,
            categoria: categorias,
            estado: 'ACTIVO'
          }
        }
      );

      // Paso 3: Procesar nuevos documentos
      job.progress(30);
      const documentosActualizados = [];
      const totalArchivos = adaptedFiles.length;

      for (let i = 0; i < adaptedFiles.length; i++) {
        const archivo = adaptedFiles[i];
        const progreso = 30 + ((i + 1) / totalArchivos) * 60; // De 30% a 90%

        job.progress(progreso);
        notificarGlobal('vehiculo:procesamiento:progreso', {
          sessionId,
          socketId,
          mensaje: `Actualizando documento ${archivo.categoria} (${i + 1}/${totalArchivos})...`,
          progreso: Math.round(progreso)
        });

        try {
          // Validar que el archivo tenga buffer
          if (!archivo.buffer || !Buffer.isBuffer(archivo.buffer)) {
            throw new Error(`Buffer inválido para documento ${archivo.categoria}`);
          }

          // Generar nombre único para el archivo
          const extension = path.extname(archivo.filename);
          const nombreArchivo = `${vehiculoId}_${archivo.categoria}_${Date.now()}${extension}`;
          const rutaArchivo = path.join(process.env.UPLOAD_PATH || './uploads', nombreArchivo);

          // Crear directorio si no existe
          const directorioUploads = path.dirname(rutaArchivo);
          await fs.mkdir(directorioUploads, { recursive: true });

          // Guardar archivo físico
          await fs.writeFile(rutaArchivo, archivo.buffer);

          // Crear nuevo registro de documento
          const documentoActualizado = await Documento.create({
            vehiculoId: vehiculoId,
            categoria: archivo.categoria,
            nombreOriginal: archivo.filename,
            nombreArchivo,
            rutaArchivo,
            mimetype: archivo.mimetype,
            tamaño: archivo.buffer.length,
            fechaVigencia: fechasVigencia?.[archivo.categoria] || null,
            estado: 'ACTIVO',
            fechaSubida: new Date()
          });

          documentosActualizados.push(documentoActualizado);

          logger.info(`Documento ${archivo.categoria} actualizado para vehículo ${vehiculoId}`);
        } catch (error) {
          logger.error(`Error actualizando documento ${archivo.categoria}: ${error.message}`);
          throw new Error(`Error al actualizar documento ${archivo.categoria}: ${error.message}`);
        }
      }

      // Paso 4: Actualizar fechas de vigencia en el vehículo
      job.progress(95);
      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Finalizando actualización...',
        progreso: 95
      });

      if (fechasVigencia && Object.keys(fechasVigencia).length > 0) {
        // Actualizar campos específicos de fechas de vigencia en Sequelize
        const updateFields = {};
        Object.keys(fechasVigencia).forEach(categoria => {
          const campo = `${categoria.toLowerCase()}_vencimiento`;
          updateFields[campo] = new Date(fechasVigencia[categoria]);
        });

        await vehiculo.update(updateFields);
      }

      // Paso 5: Finalizar
      job.progress(100);
      const vehiculoActualizado = await Vehiculo.findByPk(vehiculoId);

      notificarGlobal('vehiculo:procesamiento:completado', {
        sessionId,
        socketId,
        tipo: 'actualizacion',
        vehiculo: vehiculoActualizado,
        documentos: documentosActualizados,
        mensaje: 'Documentos actualizados exitosamente',
        progreso: 100
      });

      // Notificar globalmente la actualización del vehículo
      notificarGlobal('vehiculo:actualizado', {
        vehiculo: vehiculoActualizado,
        documentosActualizados,
        categoriasActualizadas: categorias
      });

      logger.info(`Actualización de documentos completada: ${sessionId}`);
      return { vehiculo: vehiculoActualizado, documentos: documentosActualizados };

    } catch (error) {
      logger.error(`Error en actualización ${sessionId}: ${error.message}`);

      notificarGlobal('vehiculo:procesamiento:error', {
        sessionId,
        socketId,
        tipo: 'actualizacion',
        vehiculoId,
        error: error.message,
        mensaje: 'Error al actualizar los documentos'
      });

      throw error;
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
    await vehiculoActualizacionQueue.add('actualizar-documentos-vehiculo', jobData, {
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