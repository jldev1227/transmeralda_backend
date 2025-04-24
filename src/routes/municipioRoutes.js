const express = require('express');
const router = express.Router();
const municipioController = require('../controllers/municipioController');

// Ruta para obtener todos los municipios
router.get('/', municipioController.obtenerTodos);

// Ruta para obtener un municipio por ID
router.get('/:id', municipioController.obtenerPorId);

module.exports = router;