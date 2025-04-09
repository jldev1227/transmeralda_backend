// src/routes/vehiculoRoutes.js
const express = require('express');
const router = express.Router();
const { 
  getVehiculos, 
  getVehiculoById, 
  createVehiculo, 
  updateVehiculo, 
  deleteVehiculo,
  updateEstadoVehiculo,
  updateUbicacionVehiculo,
  updateKilometrajeVehiculo,
  deleteGaleriaImage,
  asignarConductor,
  buscarVehiculosPorPlaca,
  getVehiculosBasicos,
  uploadGaleriaImages,
  uploadDocumentos,
  getProgressProccess
} = require('../controllers/vehiculoController');
const { protect } = require('../middleware/auth');

// Rutas públicas
router.get('/buscar', buscarVehiculosPorPlaca);

// Rutas para todos los usuarios autenticados
router.get('/', getVehiculos);
router.get('/basicos', getVehiculosBasicos);
router.get('/:id', getVehiculoById);

// Rutas solo para administradores
router.post('/', protect, uploadDocumentos, createVehiculo);
router.put('/:id', protect, uploadGaleriaImages, updateVehiculo);
router.delete('/:id', protect, deleteVehiculo);
router.patch('/:id/estado', protect, updateEstadoVehiculo);
router.patch('/:id/ubicacion', updateUbicacionVehiculo);
router.patch('/:id/kilometraje', updateKilometrajeVehiculo);
router.delete('/:id/galeria', protect, deleteGaleriaImage);
router.patch('/:id/conductor', protect, asignarConductor);


// Obtener progreso drouter.get('/progreso/:sessionId', async (req, res) => {
router.get('/progreso/:sessionId', protect, getProgressProccess)

module.exports = router;