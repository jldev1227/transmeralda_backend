const express = require('express');
const router = express.Router();
const conductorController = require('../controllers/conductorController');
const { 
  validarCreacionConductor, 
  validarActualizacionConductor 
} = require('../middleware/validacionConductor'); // Crea este middleware de validación

// CRUD de Conductores
router.post('/', validarCreacionConductor, conductorController.crearConductor);
router.get('/', conductorController.obtenerConductores);
router.get('/basicos', conductorController.obtenerConductoresBasicos);
router.get('/:id', conductorController.obtenerConductorPorId);
router.put('/:id', validarActualizacionConductor, conductorController.actualizarConductor);
router.delete('/:id', conductorController.eliminarConductor);

// Asignación de conductor a vehículo
router.post('/asignar-vehiculo', conductorController.asignarConductorAVehiculo);

module.exports = router;