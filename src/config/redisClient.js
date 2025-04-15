// src/config/redisClient.js
const Redis = require('ioredis');

// Cargar variables de entorno si no se ha hecho ya
if (!process.env.REDIS_HOST) {
  require('dotenv').config();
}

// Opciones básicas de configuración para Redis (compatibles con Bull)
const redisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379')
};

// Añadir password solo si está definida
if (process.env.REDIS_PASSWORD) {
  redisOptions.password = process.env.REDIS_PASSWORD;
}

// Opciones extendidas para el cliente principal (NO para Bull)
const redisClientOptions = {
  ...redisOptions,
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

// Crear la instancia del cliente Redis con opciones extendidas
const redisClient = new Redis(redisClientOptions);

// Manejar eventos
redisClient.on('connect', () => {
  console.log('Conectado a Redis');
});

redisClient.on('error', (err) => {
  console.error('Error en la conexión a Redis:', err);
});

redisClient.on('reconnecting', () => {
  console.log('Reconectando a Redis...');
});

// Exportar el cliente Redis y las opciones básicas (para Bull)
module.exports = { redisClient, redisOptions };