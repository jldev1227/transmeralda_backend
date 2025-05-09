5// routes/liquidacionesRoutes.js
const express = require('express');
const router = express.Router();
const liquidacionController = require('../controllers/liquidacionServiciosController');
const { protect } = require('../middleware/auth');


// Rutas para liquidaciones
router.post('/', protect, liquidacionController.crearLiquidacion);
router.get('/', protect, liquidacionController.obtenerLiquidaciones);
router.get('/:id', protect, liquidacionController.obtenerLiquidacionPorId);
router.patch('/:id', protect, liquidacionController.actualizarLiquidacion);
router.patch('/:id/aprobar', protect, liquidacionController.aprobarLiquidacion);
router.patch('/:id/rechazar', protect, liquidacionController.rechazarLiquidacion);
router.patch('/:id/regresa-liquidado', protect, liquidacionController.regresarEstadoLiquidado);

// Ruta para obtener servicios disponibles para liquidar
router.get('/servicios-disponibles', protect, liquidacionController.obtenerServiciosParaLiquidar);

// Rutas para reportes y análisis
router.get('/reporte/periodo', protect, liquidacionController.reporteLiquidacionesPorPeriodo);
router.get('/reporte/cliente/:clienteId', protect, liquidacionController.reporteLiquidacionesPorCliente);

module.exports = router;