const EventEmitter = require('events');

class VehicleEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // Aumentar límite de listeners
  }
  
  // Método helper para debug
  debug(evento) {
    console.log(`🔍 Evento: ${evento}`);
    console.log(`👂 Listeners: ${this.listenerCount(evento)}`);
    console.log(`📊 Todos los eventos: ${this.eventNames()}`);
  }
}

const eventEmitter = new VehicleEventEmitter();

module.exports = eventEmitter;