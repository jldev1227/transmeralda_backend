const express = require('express');
const router = express.Router();
const servicioController = require('../controllers/servicioController');
const { protect, hasRole } = require('../middleware/auth');
const { validatePublicJWT } = require('../middleware/publicJWT');

// ⚠️ IMPORTANTE: Las rutas específicas DEBEN ir ANTES que las rutas con parámetros dinámicos

// Rutas públicas (van primero)
router.get('/publico/:id', validatePublicJWT, servicioController.obtenerPorId);

// Rutas específicas protegidas (van antes que /:id)
router.get('/buscar', protect, servicioController.buscarServicios);

// Rutas CRUD básicas
router.get('/', protect, servicioController.obtenerTodos);
router.get('/:id', protect, servicioController.obtenerPorId);

// Rutas que requieren permisos de creación/edición
router.post('/', protect, servicioController.crear);
router.put('/:id', protect, servicioController.actualizar);
router.delete('/:id', protect, hasRole(['gestor_servicio', 'admin']), servicioController.eliminar);
router.patch('/:id/cancelar', protect, hasRole(['gestor_servicio', 'admin']), servicioController.cancelar);

// Rutas específicas para cambiar estado
router.patch('/:id/estado', protect, servicioController.cambiarEstado);
router.patch('/:id/planilla', protect, hasRole(['gestor_planillas', 'admin']), servicioController.asignarNumeroPlanilla);

// Rutas para gestión de tokens públicos
router.post('/:id/compartir', protect, servicioController.generarEnlacePublico);
router.delete('/token/:token', protect, servicioController.revocarToken);

module.exports = router;