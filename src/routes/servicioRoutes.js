const express = require('express');
const router = express.Router();
const servicioController = require('../controllers/servicioController');
const { protect, isAdmin } = require('../middleware/auth'); // Asumiendo que tienes middleware de autenticación

// Rutas públicas (si las hay)

// Rutas CRUD básicas
router.get('/', servicioController.obtenerTodos);
router.get('/buscar', servicioController.buscarServicios);
router.get('/:id', servicioController.obtenerPorId);

// Rutas que requieren permisos de creación/edición
router.post('/', protect, servicioController.crear);
router.put('/:id', protect, servicioController.actualizar);
router.delete('/:id', isAdmin, servicioController.eliminar);

// Ruta específica para cambiar estado
router.patch('/:id/estado', protect, servicioController.cambiarEstado);

module.exports = router;