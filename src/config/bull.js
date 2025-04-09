// config/bull.js
const Queue = require('bull');

/**
 * Inicializa las colas de Bull y las integra con Socket.IO
 * @param {Express.Application} app - Aplicación Express
 */
function setupBullQueues(app) {
  const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD
  };
  
  // Crear las colas principales
  const pdfQueue = new Queue('pdf-generation', { redis: redisConfig });
  const emailQueue = new Queue('email-sending', { redis: redisConfig });
  
  // Configurar funciones de notificación para eventos de la cola
  setupQueueEvents(pdfQueue, app, 'pdf');
  setupQueueEvents(emailQueue, app, 'email');
  
  // Exponer las colas para uso en otros módulos
  app.set('pdfQueue', pdfQueue);
  app.set('emailQueue', emailQueue);
  
  console.log('Bull queues initialized and connected to Redis');
}

/**
 * Configura eventos para una cola y los integra con Socket.IO
 * @param {Bull.Queue} queue - Cola de Bull
 * @param {Express.Application} app - Aplicación Express
 * @param {string} queueName - Nombre de la cola (para logs)
 */
function setupQueueEvents(queue, app, queueName) {
  // Función para obtener notifyUser
  const getNotifyUser = () => app.get('notifyUser');
  
  // Evento: trabajo completado
  queue.on('completed', async (job, result) => {
    // Obtener información del trabajo
    const { jobId, userId } = job.data;
    
    if (jobId && userId) {
      const notifyUser = getNotifyUser();
      if (notifyUser) {
        // Solo notificar si el resultado no viene de otra cola
        // (evitar notificaciones duplicadas)
        if (!result || !result.forwarded) {
          notifyUser(userId, 'job:progress', { jobId, progress: 100 });
        }
      }
    }
  });
  
  // Evento: trabajo falló
  queue.on('failed', (job, error) => {
    console.error(`[${queueName}] Job ${job.id} failed:`, error);
    
    // Obtener información del trabajo
    const { jobId, userId } = job.data;
    
    if (jobId && userId) {
      const notifyUser = getNotifyUser();
      if (notifyUser) {
        notifyUser(userId, 'job:failed', { 
          jobId, 
          error: error.message || 'Error desconocido' 
        });
      }
    }
  });
  
  // Otros eventos útiles para monitoreo
  queue.on('error', (error) => {
    console.error(`[${queueName}] Queue error:`, error);
  });
  
  queue.on('stalled', (job) => {
    console.warn(`[${queueName}] Job ${job.id} stalled`);
  });
}

/**
 * Inicia un panel de administración para las colas (opcional)
 * Requiere instalar: npm install bull-board
 */
function setupBullBoard(app, queues) {
  try {
    const { createBullBoard } = require('@bull-board/api');
    const { BullAdapter } = require('@bull-board/api/bullAdapter');
    const { ExpressAdapter } = require('@bull-board/express');
    
    const serverAdapter = new ExpressAdapter();
    
    // Configurar Bull Board
    createBullBoard({
      queues: queues.map(queue => new BullAdapter(queue)),
      serverAdapter,
    });
    
    // Montar Bull Board en la aplicación Express (ruta protegida)
    serverAdapter.setBasePath('/admin/queues');
    app.use('/admin/queues', (req, res, next) => {
      // Añadir autenticación aquí si es necesario
      const isAdmin = req.usuario?.role === 'admin'; 
      if (!isAdmin) {
        return res.status(403).send('Acceso denegado');
      }
      next();
    }, serverAdapter.getRouter());
    
    console.log('Bull Board initialized at /admin/queues');
  } catch (error) {
    console.warn('Bull Board not initialized. Install with: npm install @bull-board/api @bull-board/express');
  }
}

module.exports = {
  setupBullQueues,
  setupBullBoard
};