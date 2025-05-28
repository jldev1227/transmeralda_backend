const Queue = require('bull');
const { redisOptions } = require('../config/redisClient');
const logger = require('../utils/logger');
const { Vehiculo, Documento } = require('../models');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { uploadProcessedDocuments, saveTemporaryDocument } = require('../controllers/documentoController');
const fs = require('fs').promises;
const { redisClient } = require('../config/redisClient');

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

    console.log(job.data, "Datos del vehículo en el procesador");

    try {
      // ✅ Usar hmset para compatibilidad total
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'procesados', '0',
        'totalDocumentos', adaptedFiles.length.toString(),
        'progreso', '0',
        'estado', 'procesando',
        'mensaje', 'Iniciando procesamiento de documentos...'
      );

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

      // Verificar si la placa ya existe
      const vehiculoExistente = await Vehiculo.findOne({
        where: { placa: datosVehiculo.placa }
      });

      if (vehiculoExistente) {
        const errorMsg = `Ya existe un vehículo con la placa ${datosVehiculo.placa}`;
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'estado', 'error',
          'error', errorMsg
        );
        throw new Error(errorMsg);
      }

      // Validar documentos obligatorios
      const categoriasObligatorias = ["TARJETA_DE_PROPIEDAD"];
      const categoriasFaltantes = categoriasObligatorias.filter(
        (categoria) => !categorias.includes(categoria)
      );

      if (categoriasFaltantes.length > 0) {
        const errorMsg = `Falta la tarjeta de propiedad, que es obligatoria.`;
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'estado', 'error',
          'error', errorMsg
        );
        throw new Error(errorMsg);
      }

      // Validar que el número de archivos coincida con las categorías
      if (adaptedFiles.length !== categorias.length) {
        const errorMsg = `El número de archivos (${adaptedFiles.length}) no coincide con el número de categorías (${categorias.length})`;
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'estado', 'error',
          'error', errorMsg
        );
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

      const nuevoVehiculo = await Vehiculo.create({
        ...datosVehiculo,
        estado: 'DISPONIBLE'
      });

      // ✅ Almacenar ID del vehículo en Redis
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'vehiculo_id', nuevoVehiculo.id
      );

      logger.info(`Vehículo creado con ID: ${nuevoVehiculo.id}`);

      // Paso 3: Guardar documentos temporalmente y almacenar en Redis
      job.progress(30);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '30',
        'mensaje', 'Procesando documentos...'
      );

      const totalArchivos = adaptedFiles.length;

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

        } catch (error) {
          logger.error(`Error procesando documento ${archivo.categoria}: ${error.message}`);

          // ✅ Actualizar Redis con error específico del documento usando comandos separados
          await redisClient.hmset(`vehiculo:${sessionId}`,
            'estado', 'error',
            'error', `Error al procesar documento ${archivo.categoria}: ${error.message}`
          );
          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${archivo.categoria}_error`, error.message);

          // Si falla un documento, eliminar el vehículo creado
          await Vehiculo.destroy({ where: { id: nuevoVehiculo.id } });
          throw new Error(`Error al procesar documento ${archivo.categoria}: ${error.message}`);
        }
      }

      // Paso 4: Subir documentos finales a S3 y crear registros en BD
      job.progress(80);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '80',
        'mensaje', 'Subiendo documentos a S3...'
      );

      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Subiendo documentos a S3...',
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

        // ✅ Actualizar Redis con error de subida
        await redisClient.hmset(`vehiculo:${sessionId}`,
          'estado', 'error',
          'error', `Error al subir documentos: ${uploadError.message}`,
          'error_tipo', 'upload_s3'
        );

        // Si falla la subida, eliminar el vehículo
        await Vehiculo.destroy({ where: { id: nuevoVehiculo.id } });
        throw new Error(`Error al subir documentos: ${uploadError.message}`);
      }

    } catch (error) {
      logger.error(`Error en procesamiento de creación ${sessionId}: ${error.message}`);

      // ✅ Actualizar Redis con error general
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'estado', 'error',
        'error', error.message,
        'mensaje', 'Error al crear el vehículo',
        'fecha_error', new Date().toISOString()
      );

      notificarGlobal('vehiculo:procesamiento:error', {
        sessionId,
        socketId,
        tipo: 'creacion',
        error: error.message,
        mensaje: 'Error al crear el vehículo'
      });

      // Limpiar archivos temporales en caso de error
      try {
        const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);
        await fs.rm(tempDir, { recursive: true, force: true });
        logger.info(`Directorio temporal limpiado: ${tempDir}`);
      } catch (cleanupError) {
        logger.warn(`Error al limpiar directorio temporal: ${cleanupError.message}`);
      }

      throw error;
    } finally {
      // ✅ Configurar expiración de datos en Redis (opcional)
      await redisClient.expire(`vehiculo:${sessionId}`, 86400); // Expira en 24 horas
    }
  });

  // Procesador para actualización de vehículos - REESTRUCTURADO
  vehiculoActualizacionQueue.process('actualizar-vehiculo', async (job) => {
    const { sessionId, adaptedFiles, categorias, fechasVigencia, vehiculoId, socketId, camposBasicos } = job.data;

    console.log(job.data)

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

      for (let i = 0; i < adaptedFiles.length; i++) {
        const archivo = adaptedFiles[i];
        const progreso = 50 + ((i + 1) / totalArchivos) * 30; // De 50% a 80%

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

        } catch (error) {
          logger.error(`Error procesando documento ${archivo.categoria}: ${error.message}`);

          // ✅ Actualizar Redis con error específico del documento usando comandos separados
          await redisClient.hmset(`vehiculo:${sessionId}`,
            'estado', 'error',
            'error', `Error al procesar documento ${archivo.categoria}: ${error.message}`
          );
          await redisClient.hset(`vehiculo:${sessionId}`, `documento_${archivo.categoria}_error`, error.message);

          throw new Error(`Error al procesar documento ${archivo.categoria}: ${error.message}`);
        }
      }

      // Paso 6: Subir documentos finales a S3 y crear registros en BD
      job.progress(80);
      await redisClient.hmset(`vehiculo:${sessionId}`,
        'progreso', '80',
        'mensaje', 'Subiendo documentos a S3...'
      );

      notificarGlobal('vehiculo:procesamiento:progreso', {
        sessionId,
        socketId,
        mensaje: 'Subiendo documentos a S3...',
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
        const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);
        await fs.rm(tempDir, { recursive: true, force: true });
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