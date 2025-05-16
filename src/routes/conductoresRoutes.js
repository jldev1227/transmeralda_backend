const express = require('express');
const router = express.Router();
const conductorController = require('../controllers/conductorController');
const { protect } = require('../middleware/auth');

// CRUD de Conductores
router.post('/', protect, conductorController.crearConductor);
router.get('/', protect, conductorController.obtenerConductores);
router.get('/basicos', protect, conductorController.obtenerConductoresBasicos);
router.get('/:id', protect, conductorController.obtenerConductorPorId);
router.put('/:id', protect, conductorController.actualizarConductor);
router.delete('/:id', protect, conductorController.eliminarConductor);

// Asignación de conductor a vehículo
router.post('/asignar-vehiculo', conductorController.asignarConductorAVehiculo);

module.exports = router;