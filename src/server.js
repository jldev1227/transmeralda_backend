require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { sequelize, testConnection } = require('./config/database.js');
const { setupBullQueues, setupBullBoard } = require('./config/bull');
const documentController = require('./controllers/documentoController.js');
const { scheduleRecurringCheck } = require('./queues/serviceStatusQueue');
const { inicializarProcesadoresVehiculo } = require('./queues/vehiculo.js');
const logger = require('./utils/logger');
const { redisClient } = require('./config/redisClient.js');
const eventEmitter = require('./utils/eventEmitter.js');
const { inicializarProcesadoresConductor, inicializarProcesadoresConductorMinistral } = require('./queues/conductor.js');

// Inicializar app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(helmet({
  // Desactivar contentSecurityPolicy para permitir WebSockets
  contentSecurityPolicy: false
}));

// Aumentar el límite de tamaño del body de las peticiones
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cookieParser());

// Iniciar puerto
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'https://nomina.transmeralda.com',
  'http://nomina.midominio.local:3000',
  'https://auth.transmeralda.com',
  'https://flota.transmeralda.com',
  'http://flota.midominio.local:3000',
  'http://auth.midominio.local:3001',
  "http://servicios.midominio.local:3000"
];

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'Accept', 
    'Origin',
    "socket-id"
  ]
};

// Aplicación en Express
app.use(cors(corsOptions));

// Configuración de Socket.IO
const io = socketIO(server, {
  cors: {
    // Permitir todos los orígenes necesarios
    origin: [
      "http://flota.midominio.local:3000",
      "http://flota.midominio.local",
      "http://nomina.midominio.local:3000",
      "http://servicios.midominio.local:3000"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "socket-id"],
    credentials: true
  },
  transports: ['polling', 'websocket'] // Poner polling primero
});
global.io = io;

// Almacenar conexiones de sockets por ID de usuario
const userSockets = new Map();

// Gestión de conexiones Socket.IO
io.on('connection', (socket) => {
  console.log('Nuevo cliente conectado:', socket.id);
  
  // Obtener userId de la consultaf
  const userId = socket.handshake.query.userId;
  if (userId) {
    // Guardar referencia del socket del usuario
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);
    
    console.log(`Usuario ${userId} conectado con socket ${socket.id}`);
  }

  // ====== MANEJADORES DE CONFIRMACIÓN DE VEHÍCULOS ======
  
  // Escuchar respuestas de confirmación
  socket.on('vehiculo:confirmacion:respuesta', async (data) => {
    try {
      const { sessionId, accion, datosModificados } = data;
      
      logger.info(`Recibida respuesta de confirmación para sesión ${sessionId}:`, data);
      
      // Validar datos básicos
      if (!sessionId || !accion) {
        logger.error('SessionId y acción son requeridos');
        socket.emit('vehiculo:confirmacion:error', { 
          mensaje: 'SessionId y acción son requeridos' 
        });
        return;
      }
      
      // Verificar que efectivamente estamos esperando confirmación
      const esperandoConfirmacion = await redisClient.hget(`vehiculo:${sessionId}`, 'esperando_confirmacion');
      if (esperandoConfirmacion !== 'true') {
        logger.warn(`No se esperaba confirmación para la sesión ${sessionId}`);
        socket.emit('vehiculo:confirmacion:error', { 
          sessionId,
          mensaje: 'No se esperaba confirmación para esta sesión' 
        });
        return;
      }
      
      // Validar acción
      const accionesValidas = ['confirmar', 'editar', 'cancelar'];
      if (!accionesValidas.includes(accion)) {
        logger.error(`Acción inválida recibida: ${accion}`);
        socket.emit('vehiculo:confirmacion:error', { 
          sessionId,
          mensaje: 'Acción inválida' 
        });
        return;
      }

      // Validar datos según la acción
      if (accion === 'editar') {
        if (!datosModificados || typeof datosModificados !== 'object') {
          logger.error('Acción editar requiere datosModificados válidos');
          socket.emit('vehiculo:confirmacion:error', { 
            sessionId,
            mensaje: 'Datos modificados requeridos para editar' 
          });
          return;
        }
        
        // Validar campos obligatorios
        if (datosModificados.propietario_nombre !== undefined && 
            (!datosModificados.propietario_nombre || datosModificados.propietario_nombre.trim() === '')) {
          socket.emit('vehiculo:confirmacion:error', { 
            sessionId,
            mensaje: 'El nombre del propietario no puede estar vacío' 
          });
          return;
        }
      }
      
      // Almacenar la respuesta en Redis
      await redisClient.hmset(`vehiculo:${sessionId}:confirmacion:respuesta`, 
        'accion', accion,
        'datosModificados', datosModificados ? JSON.stringify(datosModificados) : '',
        'timestamp', Date.now().toString(),
        'socketId', socket.id,
        'userId', userId || '',
        'procesado', 'false'
      );
      
      // Marcar que ya no estamos esperando confirmación
      await redisClient.hset(`vehiculo:${sessionId}`, 'esperando_confirmacion', 'false');
    
      const eventName = `vehiculo:confirmacion:respuesta:${sessionId}`;
      
      // 🔥 info: Verificar estado antes de emit
      logger.info(`📡 A punto de emitir evento: ${eventName}`);
      
      // ✅ EMITIR EVENTO INTERNO
      eventEmitter.emit(eventName, {
        sessionId,
        socketId: socket.id,
        accion,
        datosModificados,
        timestamp: Date.now(),
        userId
      });
      
      logger.info(`🔥 Evento emitido exitosamente: ${eventName}`);
      
      
      // Confirmar recepción al cliente
      socket.emit('vehiculo:confirmacion:recibida', { 
        sessionId,
        accion,
        mensaje: `Confirmación ${accion} recibida correctamente` 
      });
      
      logger.info(`Respuesta de confirmación procesada para sesión ${sessionId}: ${accion}`);
      
    } catch (error) {
      logger.error(`Error procesando respuesta de confirmación:`, error);
      socket.emit('vehiculo:confirmacion:error', { 
        mensaje: 'Error procesando confirmación',
        error: error.message 
      });
    }
  });

  // Solicitar estado de confirmación
  socket.on('vehiculo:confirmacion:estado', async (data) => {
    try {
      const { sessionId } = data;
      
      if (!sessionId) {
        socket.emit('vehiculo:confirmacion:estado:respuesta', {
          error: 'SessionId requerido'
        });
        return;
      }
      
      const estado = await verificarEstadoConfirmacionVehiculo(sessionId);
      const progreso = await redisClient.hget(`vehiculo:${sessionId}`, 'progreso');
      const mensaje = await redisClient.hget(`vehiculo:${sessionId}`, 'mensaje');
      
      socket.emit('vehiculo:confirmacion:estado:respuesta', {
        sessionId,
        estado,
        progreso: progreso ? parseInt(progreso) : 0,
        mensaje: mensaje || 'Sin información'
      });
      
    } catch (error) {
      logger.error('Error obteniendo estado de confirmación:', error);
      socket.emit('vehiculo:confirmacion:estado:respuesta', {
        error: 'Error obteniendo estado'
      });
    }
  });

  // Cancelar proceso de confirmación
  socket.on('vehiculo:confirmacion:cancelar', async (data) => {
    try {
      const { sessionId } = data;
      
      if (!sessionId) {
        socket.emit('vehiculo:confirmacion:error', {
          mensaje: 'SessionId requerido para cancelar'
        });
        return;
      }
      
      const esperandoConfirmacion = await redisClient.hget(`vehiculo:${sessionId}`, 'esperando_confirmacion');
      
      if (esperandoConfirmacion === 'true') {
        // Emitir evento de cancelación
        socket.emit(`vehiculo:confirmacion:respuesta:${sessionId}`, {
          sessionId,
          socketId: socket.id,
          accion: 'cancelar',
          timestamp: Date.now(),
          userId
        });
        
        await redisClient.hset(`vehiculo:${sessionId}`, 'esperando_confirmacion', 'false');
        
        socket.emit('vehiculo:confirmacion:cancelada', {
          sessionId,
          mensaje: 'Proceso cancelado exitosamente'
        });
        
        logger.info(`Proceso de confirmación cancelado por usuario para sesión ${sessionId}`);
      } else {
        socket.emit('vehiculo:confirmacion:error', {
          sessionId,
          mensaje: 'No hay proceso de confirmación activo'
        });
      }
      
    } catch (error) {
      logger.error('Error cancelando confirmación:', error);
      socket.emit('vehiculo:confirmacion:error', {
        mensaje: 'Error cancelando proceso'
      });
    }
  });

  // ====== OTROS EVENTOS DE VEHÍCULOS ======
  
  // Obtener progreso de procesamiento
  socket.on('vehiculo:progreso:consultar', async (data) => {
    try {
      const { sessionId } = data;
      
      if (!sessionId) {
        socket.emit('vehiculo:progreso:respuesta', {
          error: 'SessionId requerido'
        });
        return;
      }
      
      const datosProgreso = await redisClient.hmget(`vehiculo:${sessionId}`,
        'progreso', 'mensaje', 'estado', 'documento_actual', 'procesados', 'totalDocumentos'
      );
      
      socket.emit('vehiculo:progreso:respuesta', {
        sessionId,
        progreso: datosProgreso[0] ? parseInt(datosProgreso[0]) : 0,
        mensaje: datosProgreso[1] || 'Sin información',
        estado: datosProgreso[2] || 'unknown',
        documentoActual: datosProgreso[3] || '',
        procesados: datosProgreso[4] ? parseInt(datosProgreso[4]) : 0,
        totalDocumentos: datosProgreso[5] ? parseInt(datosProgreso[5]) : 0
      });
      
    } catch (error) {
      logger.error('Error consultando progreso:', error);
      socket.emit('vehiculo:progreso:respuesta', {
        error: 'Error consultando progreso'
      });
    }
  });
  
  // Manejar desconexión
  socket.on('disconnect', async () => {
    logger.info('Cliente desconectado:', socket.id);
    
    try {
      // Verificar si hay procesos de confirmación activos para este socket
      const keys = await redisClient.keys('vehiculo:*');
      const sessionKeys = keys.filter(key => key.match(/^vehiculo:[^:]+$/));
      
      for (const key of sessionKeys) {
        const sessionId = key.split(':')[1];
        const confirmacionData = await redisClient.hmget(`vehiculo:${sessionId}`, 
          'esperando_confirmacion', 'socketId'
        );
        
        if (confirmacionData[0] === 'true') {
          // Verificar si este socket estaba asociado con la sesión
          const socketIdEnSesion = confirmacionData[1];
          
          if (socketIdEnSesion === socket.id) {
            logger.warn(`Cliente desconectado durante confirmación de sesión ${sessionId}`);
            
            // Marcar timeout por desconexión
            await redisClient.hmset(`vehiculo:${sessionId}`, 
              'esperando_confirmacion', 'false',
              'desconexion_confirmacion', 'true'
            );
            
            // Emitir evento de timeout por desconexión
            socket.emit(`vehiculo:confirmacion:respuesta:${sessionId}`, {
              sessionId,
              socketId: socket.id,
              accion: 'timeout_desconexion',
              mensaje: 'Cliente desconectado durante confirmación',
              timestamp: Date.now()
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error manejando desconexión durante confirmación:', error);
    }
    
    // Eliminar socket del registro de usuarios
    if (userId && userSockets.has(userId)) {
      userSockets.get(userId).delete(socket.id);
      
      // Si no hay más sockets para este usuario, eliminar entrada
      if (userSockets.get(userId).size === 0) {
        userSockets.delete(userId);
      }
    }
  });
});

// Función para verificar estado de confirmación
async function verificarEstadoConfirmacionVehiculo(sessionId) {
  try {
    const estado = await redisClient.hmget(`vehiculo:${sessionId}`, 
      'esperando_confirmacion', 
      'timeout_confirmacion',
      'desconexion_confirmacion',
      'estado'
    );
    
    return {
      esperandoConfirmacion: estado[0] === 'true',
      timeoutConfirmacion: estado[1] === 'true',
      desconexionConfirmacion: estado[2] === 'true',
      estadoProceso: estado[3] || 'unknown'
    };
  } catch (error) {
    logger.error(`Error verificando estado de confirmación para sesión ${sessionId}:`, error);
    return { 
      esperandoConfirmacion: false, 
      timeoutConfirmacion: false,
      desconexionConfirmacion: false,
      estadoProceso: 'error'
    };
  }
}

// Función para enviar actualizaciones a un usuario específico
const notifyUser = (userId, event, data) => {
  if (userSockets.has(userId)) {
    const userSocketIds = userSockets.get(userId);
    logger.info(`Enviando ${event} a usuario ${userId} (${userSocketIds.size} conexiones)`);
    
    for (const socketId of userSocketIds) {
      logger.info(`Enviando evento ${event} a socketId ${socketId}`);
      io.to(socketId).emit(event, data);
    }
    return true;
  }
  logger.info(`Usuario ${userId} no está conectado para recibir ${event}`);
  return false;
};

// Exponer funciones de socket.io a otros módulos
app.set('io', io);
app.set('notifyUser', notifyUser);
app.set('trust proxy', false);


// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Infinity, // sin limites
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', limiter);

// En routes/documentRoutes.js, añade:

// Ruta de prueba para subir un documento (requiere un archivo test.pdf en la raíz del proyecto)
app.get('/test-upload/:vehicleId', async (req, res) => {
  try {
    // Llamamos al controlador
    await documentController.testUpload(req, res);
  } catch (error) {
    console.error('Error en test-upload:', error);
    res.status(500).json({ error: 'Error en test-upload' });
  }
});
// Rutas
app.use('/api/usuarios', require('./routes/userRoutes'));
app.use('/api/nomina', require('./routes/nominaRoutes'));
app.use('/api/flota', require('./routes/flotaRoutes'));
app.use('/api/empresas', require('./routes/empresaRoutes'));
app.use('/api/municipios', require('./routes/municipioRoutes'));
app.use('/api/conductores', require('./routes/conductoresRoutes.js'));
app.use('/api/servicios', require('./routes/servicioRoutes.js'));
app.use('/api/servicios-historico', require('./routes/servicioHistoricoRoutes.js'));
app.use('/api/liquidaciones_servicios', require('./routes/liquidacionServiciosRoutes.js'));
app.use('/api/documentos', require('./routes/documentoRoutes.js'));
app.use('/api/documentos-conductor', require('./routes/documentosRequeridosConductorRoutes.js'));
app.use('/api/export', require('./routes/exportRoutes'));
app.use('/api/pdf', require('./routes/desprendibleNominaRoutes'));

// Ruta de verificación de salud
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'El servidor está funcionando correctamente' });
});

// Ruta de verificación de socket
app.get('/socket-check', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    socketWorking: true,
    activeConnections: io.engine.clientsCount,
    activeUsers: userSockets.size
  });
});

// Middleware para manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Recurso no encontrado' 
  });
});

// Función para emitir eventos de liquidación a todos los clientes
const emitLiquidacionEvent = (eventName, data) => {
  console.log(`Emitiendo evento ${eventName}:`, data);
  io.emit(eventName, data);
};

// Función para emitir eventos de liquidación a un usuario específico
const emitLiquidacionToUser = (userId, eventName, data) => {
  if (userSockets.has(userId)) {
    const userSocketIds = userSockets.get(userId);
    console.log(`Enviando ${eventName} a usuario ${userId} (${userSocketIds.size} conexiones)`);
    
    for (const socketId of userSocketIds) {
      io.to(socketId).emit(eventName, data);
    }
    return true;
  }
  console.log(`Usuario ${userId} no está conectado para recibir ${eventName}`);
  return false;
};

// Exponer funciones de socket.io para liquidaciones a otros módulos
app.set('emitLiquidacionEvent', emitLiquidacionEvent);
app.set('emitLiquidacionToUser', emitLiquidacionToUser);


// Función para emitir eventos de vehiculos a todos los clientes
const emitVehiculoEvent = (eventName, data) => {
  console.log(`Emitiendo evento ${eventName}:`, data);
  io.emit(eventName, data);
};

// Función para emitir eventos de vehiculo a un usuario específico
const emitVehiculoToUser = (userId, eventName, data) => {
  if (userSockets.has(userId)) {
    const userSocketIds = userSockets.get(userId);
    console.log(`Enviando ${eventName} a usuario ${userId} (${userSocketIds.size} conexiones)`);
    
    for (const socketId of userSocketIds) {
      io.to(socketId).emit(eventName, data);
    }
    return true;
  }
  console.log(`Usuario ${userId} no está conectado para recibir ${eventName}`);
  return false;
};

// Función para emitir eventos de conductores a todos los clientes
const emitConductorEvent = (eventName, data) => {
  console.log(`Emitiendo evento ${eventName}:`, data);
  io.emit(eventName, data);
};

// Función para emitir eventos de Conductor a un usuario específico
const emitConductorToUser = (userId, eventName, data) => {
  if (userSockets.has(userId)) {
    const userSocketIds = userSockets.get(userId);
    console.log(`Enviando ${eventName} a usuario ${userId} (${userSocketIds.size} conexiones)`);
    
    for (const socketId of userSocketIds) {
      io.to(socketId).emit(eventName, data);
    }
    return true;
  }
  console.log(`Usuario ${userId} no está conectado para recibir ${eventName}`);
  return false;
};

// Exponer funciones de socket.io para vehiculos a otros módulos
app.set('emitVehiculoEvent', emitVehiculoEvent);
app.set('emitVehiculoToUser', emitVehiculoToUser);

// Exponer funciones de socket.io para conductores a otros módulos
app.set('emitConductorEvent', emitConductorEvent);
app.set('emitConductorToUser', emitConductorToUser);

// Función para emitir eventos de servicios a todos los clientes
const emitServicioEvent = (eventName, data) => {
  console.log(`Emitiendo evento ${eventName}:`, data);
  io.emit(eventName, data);
};

// Función para emitir eventos de servicios a todos los clientes
const emitLiquidacionServicioEvent = (eventName, data) => {
  console.log(`Emitiendo evento ${eventName}:`, data);
  io.emit(eventName, data);
};

// Función para emitir eventos de servicio a un usuario específico
const emitServicioToUser = (userId, eventName, data) => {
  if (userSockets.has(userId)) {
    const userSocketIds = userSockets.get(userId);
    console.log(`Enviando ${eventName} a usuario ${userId} (${userSocketIds.size} conexiones)`);
    
    for (const socketId of userSocketIds) {
      io.to(socketId).emit(eventName, data);
    }
    return true;
  }
  console.log(`Usuario ${userId} no está conectado para recibir ${eventName}`);
  return false;
};

// Exponer funciones de socket.io para servicios a otros módulos
app.set('emitServicioEvent', emitServicioEvent);
app.set('emitServicioToUser', emitServicioToUser);
app.set('emitLiquidacionServicioEvent', emitLiquidacionServicioEvent);


// Middleware para manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Iniciar servidor
const iniciarServidor = async () => {
  try {
    // Probar conexión a la base de datos
    await testConnection();
    
    // Sincronizar modelos con la base de datos (solo en desarrollo)
    if (process.env.NODE_ENV === 'development') {
      // Solo usar force: true en desarrollo y con precaución, elimina tablas existentes
      // await sequelize.sync({ force: true });
      await sequelize.sync();
      console.log('Base de datos sincronizada');
    }

    global.app = app;
    
    // Configurar colas de Bull
    setupBullQueues(app);
    scheduleRecurringCheck();
    inicializarProcesadoresVehiculo()
    inicializarProcesadoresConductorMinistral()
    
    // Iniciar servidor HTTP con Socket.IO
    server.listen(PORT, () => {
      console.log(`Servidor corriendo en puerto ${PORT}`);
      console.log(`Ambiente: ${process.env.NODE_ENV}`);
      console.log(`Dominio: ${process.env.DOMAIN}`);
      console.log('Socket.IO habilitado y escuchando conexiones');
    
      // Configurar panel de administración de Bull (opcional)
      if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BULL_BOARD === 'true') {
        setupBullBoard(app, [
          app.get('pdfQueue'),
          app.get('emailQueue')
        ]);
      }
    });
    
  } catch (error) {
    console.error('Error al iniciar servidor:', error);
    process.exit(1);
  }
};

iniciarServidor();