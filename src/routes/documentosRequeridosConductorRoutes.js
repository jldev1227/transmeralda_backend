const express = require('express');
const documentosRequeridosController = require('../controllers/documentosRequeridosConductorController');

const router = express.Router();

// Obtener todos los documentos requeridos
router.get('/', documentosRequeridosController.getAll);

// Obtener un documento requerido por ID
router.get('/:id', documentosRequeridosController.getById);

// Crear un nuevo documento requerido
router.post('/', documentosRequeridosController.create);

// Actualizar un documento requerido por ID
router.put('/:id', documentosRequeridosController.update);

// Eliminar un documento requerido por ID
router.delete('/:id', documentosRequeridosController.delete);

module.exports = router;