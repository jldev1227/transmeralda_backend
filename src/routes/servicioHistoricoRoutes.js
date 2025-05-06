const express = require('express');
const router = express.Router();
const servicioHistoricoController = require('../controllers/servicioHistoricoController');
const { protect, hasRole, isAdmin } = require('../middleware/auth');

// Rutas públicas (si las hay)

// Rutas protegidas básicas - requieren autenticación
router.get('/servicio/:id', protect, servicioHistoricoController.obtenerHistoricoPorServicioId);
router.get('/:id', protect, servicioHistoricoController.obtenerHistoricoPorId);
router.get('/', protect, servicioHistoricoController.obtenerTodosHistoricos);

module.exports = router;