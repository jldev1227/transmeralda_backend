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

const corsOptions = {
  origin: [
    'https://nomina.transmeralda.com',
    'https://auth.transmeralda.com',
    'https://flota.transmeralda.com',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'Accept', 
    'Origin'
  ]
};

// Aplicación en Express
app.use(cors(corsOptions));

// Configuración de Socket.IO
const io = socketIO(server, {
  path: '/socket.io/',
  cors: {
    origin: [
      'https://nomina.transmeralda.com',
      'https://auth.transmeralda.com',
      'https://flota.transmeralda.com'
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling', 'websocket'] // Poner polling primero
});

// Almacenar conexiones de sockets por ID de usuario
const userSockets = new Map();

// Gestión de conexiones Socket.IO
io.on('connection', (socket) => {
  console.log('Nuevo cliente conectado:', socket.id);
  
  // Obtener userId de la consulta
  const userId = socket.handshake.query.userId;
  if (userId) {
    // Guardar referencia del socket del usuario
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);
    
    console.log(`Usuario ${userId} conectado con socket ${socket.id}`);
  }
  
  // Manejar desconexión
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
    
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

// Función para enviar actualizaciones a un usuario específico
const notifyUser = (userId, event, data) => {
  if (userSockets.has(userId)) {
    const userSocketIds = userSockets.get(userId);
    console.log(`Enviando ${event} a usuario ${userId} (${userSocketIds.size} conexiones)`);
    
    for (const socketId of userSocketIds) {
      io.to(socketId).emit(event, data);
    }
    return true;
  }
  console.log(`Usuario ${userId} no está conectado para recibir ${event}`);
  return false;
};

// Exponer funciones de socket.io a otros módulos
app.set('io', io);
app.set('notifyUser', notifyUser);
app.set('trust proxy', true);


// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Infinity, // sin limites
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', limiter);

// Rutas
app.use('/api/usuarios', require('./routes/userRoutes'));
app.use('/api/nomina', require('./routes/nominaRoutes'));
app.use('/api/flota', require('./routes/flotaRoutes'));
app.use('/api/empresas', require('./routes/empresaRoutes'));
app.use('/api/conductores', require('./routes/conductoresRoutes.js'));
app.use('/api/export', require('./routes/exportRoutes'));
app.use('/api/pdf', require('./routes/pdfRoutes'));

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

// Configurar namespace específico para liquidaciones (opcional)
const liquidacionesNamespace = io.of('/liquidaciones');

liquidacionesNamespace.on('connection', (socket) => {
  console.log('Cliente conectado al namespace de liquidaciones:', socket.id);
  
  // Obtener userId de la consulta
  const userId = socket.handshake.query.userId;
  if (userId) {
    // Almacenar la conexión de socket específica para liquidaciones
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);
    
    console.log(`Usuario ${userId} conectado a liquidaciones con socket ${socket.id}`);
    
    // Unirse a sala según rol (opcional)
    const userRole = socket.handshake.query.role; 
    if (userRole === 'admin') {
      socket.join('admins-liquidaciones');
    } else if (userRole === 'conductor') {
      socket.join('conductores-liquidaciones');
      // También unirse a sala personal
      socket.join(`liquidaciones-usuario-${userId}`);
    }
  }
  
  // Manejar desconexión
  socket.on('disconnect', () => {
    console.log('Cliente desconectado de liquidaciones:', socket.id);
    
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

// Exponer namespace de liquidaciones a otros módulos
app.set('liquidacionesNamespace', liquidacionesNamespace);

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