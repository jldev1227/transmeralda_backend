const express = require('express');
const router = express.Router();
const liquidacionController = require('../controllers/liquidacionController');
const { protect, hasRole, hasPermiso, isAdmin } = require('../middleware/auth');

// Rutas para obtener liquidaciones
router.get('/conductores', protect, hasRole(['admin', 'gestor_nomina']), liquidacionController.obtenerLiquidaciones);

// Ruta para obtener configuración (debe ir ANTES de la ruta con parámetro)
router.get('/conductores/configuracion', protect, liquidacionController.obtenerConfiguracion);

// Ruta para obtener una liquidación por ID
router.get('/conductores/:id', protect, liquidacionController.obtenerLiquidacionPorId);

// Ruta para crear una nueva liquidación
router.post('/conductores', protect, liquidacionController.crearLiquidacion);

// Ruta para editar una liquidación existente
router.put('/conductores/:id', protect, liquidacionController.editarLiquidacion);

// Ruta para editar una liquidación existente
router.delete('/conductores/:id', protect, isAdmin, liquidacionController.eliminarLiquidacion);

module.exports = router;