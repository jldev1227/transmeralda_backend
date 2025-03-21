require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { sequelize, testConnection } = require('./config/database.js');

// Inicializar app
const app = express();

// Middleware
app.use(helmet());
app.use(express.json());
app.use(cookieParser());

// Configuración de CORS para múltiples subdominios
const corsOptions = {
  origin: function (origin, callback) {
    const allowedDomains = [
      `http://${process.env.DOMAIN}:${PORT}`,
      `http://auth.${process.env.DOMAIN}:${PORT}`,
      `http://flota.${process.env.DOMAIN}:${PORT}`,
      `http://nomina.${process.env.DOMAIN}:${PORT}`
    ];

    // En desarrollo permite todas las conexiones
    if (!origin || process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // Verificar si el origen está permitido
    if (allowedDomains.indexOf(origin) !== -1 || 
        origin.endsWith(`.${process.env.DOMAIN}`)) {
      callback(null, true);
    } else {
      callback(new Error('Bloqueado por política CORS'));
    }
  },
  credentials: true, // Para permitir cookies en solicitudes cross-origin
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // límite de 100 peticiones por ventana
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

// Ruta de verificación de salud
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'El servidor está funcionando correctamente' });
});

// Middleware para manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Recurso no encontrado' 
  });
});

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
const PORT = process.env.PORT || 5000;

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
    
    // Iniciar servidor
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en puerto ${PORT}`);
      console.log(`Ambiente: ${process.env.NODE_ENV}`);
      console.log(`Dominio: ${process.env.DOMAIN}`);
    });
  } catch (error) {
    console.error('Error al iniciar servidor:', error);
    process.exit(1);
  }
};

iniciarServidor();
