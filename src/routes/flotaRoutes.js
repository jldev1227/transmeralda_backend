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
  getProgressProccess,
  getVehiculoBasico,
  createVehiculoBasico,
  updateVehiculoBasico
} = require('../controllers/vehiculoController');
const { protect, hasRole } = require('../middleware/auth');

// Rutas públicas
router.get('/buscar', protect, buscarVehiculosPorPlaca);

// Rutas para todos los usuarios autenticados
router.get('/', protect, hasRole(['admin', 'gestor_flota']), getVehiculos);
router.get('/basicos', protect, getVehiculosBasicos);
router.get('/:id', protect, hasRole(['admin', 'gestor_flota']), getVehiculoById);
router.get('/basico/:id', protect, hasRole(['admin', 'gestor_flota']), getVehiculoBasico);

// Rutas solo para administradores
router.post('/', protect, hasRole(['admin', 'gestor_flota']), uploadDocumentos, createVehiculo);
router.post('/basico', protect, hasRole(['admin', 'gestor_flota']), createVehiculoBasico);
router.put('/:id', protect, hasRole(['admin', 'gestor_flota']), uploadDocumentos, updateVehiculo);
router.put('/:id/basico', protect, hasRole(['admin', 'gestor_flota']), uploadDocumentos, updateVehiculoBasico);
router.delete('/:id', protect, hasRole(['admin', 'gestor_flota']), deleteVehiculo);
router.patch('/:id/estado', protect, hasRole(['admin', 'gestor_flota']), updateEstadoVehiculo);
router.patch('/:id/ubicacion', protect, hasRole(['admin', 'gestor_flota']), updateUbicacionVehiculo);
router.patch('/:id/kilometraje', updateKilometrajeVehiculo);
router.delete('/:id/galeria', protect, hasRole(['admin', 'gestor_flota']), deleteGaleriaImage);
router.patch('/:id/conductor', protect, hasRole(['admin', 'gestor_flota']), asignarConductor);


// Obtener progreso drouter.get('/progreso/:sessionId', async (req, res) => {
router.get('/progreso/:sessionId', protect, hasRole(['admin', 'gestor_flota']), getProgressProccess)

module.exports = router;