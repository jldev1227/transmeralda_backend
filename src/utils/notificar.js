const logger = require('./logger');
/**
 * Notifica a todos los clientes conectados
 * @param {string} evento - Nombre del evento a emitir
 * @param {object} datos - Datos a enviar
 */

exports.notificarGlobal = (evento, datos) => {
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
};

exports.notifyUser = (userId, eventoNombre, data) => {
  try {
    // Obtener la función notifyUser de la aplicación global
    const notifyFn = global.app?.get("notifyUser");

    if (notifyFn) {
      notifyFn(userId, eventoNombre, data);
    } else {
      console.log(
        `No se pudo notificar al usuario ${userId} (evento: ${eventoNombre}) - Socket.IO no está disponible`
      );
    }
  } catch (error) {
    console.error("Error al notificar al usuario:", error);
  }
};