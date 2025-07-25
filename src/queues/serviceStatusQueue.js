const Queue = require('bull');
const { Servicio } = require('../models');
const { Op } = require('sequelize');

// Crear la cola
const serviceStatusQueue = new Queue('serviceStatusUpdate', {
  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  },
  defaultJobOptions: {
    removeOnComplete: true, // Eliminar trabajo completado
    attempts: 3, // Número de intentos si falla
  },
});

// Definir el procesador de la cola
serviceStatusQueue.process(async (job) => {
  try {
    // Obtener la fecha actual
    const now = new Date();

    // Buscar servicios planificados con fecha de realización pasada
    const serviciosParaActualizar = await Servicio.findAll({
      where: {
        estado: 'planificado',
        fecha_realizacion: {
          [Op.lt]: now, // Fecha menor que ahora
          [Op.ne]: null, // Fecha no nula
        },
      },
    });

    // Actualizar los servicios encontrados
    if (serviciosParaActualizar.length > 0) {
      const actualizaciones = serviciosParaActualizar.map(async (servicio) => {
        await servicio.update({
          estado: 'en_curso',
        });
        return servicio.id;
      });

      const idsActualizados = await Promise.all(actualizaciones);

      const emitServicioToUser = req.app.get('emitServicioToUser');
      if (emitServicioToUser) {
        emitServicioToUser(servicio.conductor.id, 'servicio:estado-actualizado', {
          id: servicioActualizado.id,
          estado: servicioActualizado.estado,
          estadoAnterior,
          mensaje: `El estado del servicio ha cambiado a ${estado}`
        });
      }
      return { processed: idsActualizados.length, ids: idsActualizados };
    }

    return { processed: 0 };
  } catch (error) {
    console.error('Error al procesar la cola de actualización de servicios:', error);
    throw error; // Relanzar el error para que Bull lo maneje
  }
});

// Exportar las funciones para programar los trabajos
module.exports = {
  // Programar verificación recurrente (cada 5 minutos)
  scheduleRecurringCheck: () => {
    serviceStatusQueue.add(
      {}, // Datos vacíos, no necesitamos pasar nada
      {
        repeat: {
          every: 5 * 60 * 1000, // 5 minutos en milisegundos
        },
      }
    );
  },

  // Ejecución manual para pruebas
  runCheckNow: () => {
    return serviceStatusQueue.add({}, { priority: 1 });
  },

  // Acceso a la cola para uso en otros módulos
  queue: serviceStatusQueue,
};