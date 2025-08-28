// src/routes/tiposRecargoRoutes.js
const express = require('express');
const { body, param } = require('express-validator');
const TipoRecargoController = require('../controllers/tipoRecargoController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Middleware de autenticación para todas las rutas
router.use(protect);

// Validaciones para crear/actualizar tipos de recargo
const validacionesTipoRecargo = [
  body('codigo')
    .notEmpty()
    .withMessage('El código es requerido')
    .isLength({ max: 20 })
    .withMessage('El código no puede exceder 20 caracteres')
    .matches(/^[A-Z_]+$/)
    .withMessage('El código solo puede contener letras mayúsculas y guiones bajos'),
  
  body('nombre')
    .notEmpty()
    .withMessage('El nombre es requerido')
    .isLength({ max: 100 })
    .withMessage('El nombre no puede exceder 100 caracteres'),
  
  body('categoria')
    .notEmpty()
    .withMessage('La categoría es requerida')
    .isIn(['HORAS_EXTRAS', 'RECARGOS', 'FESTIVOS', 'SEGURIDAD_SOCIAL', 'PRESTACIONES', 'OTROS'])
    .withMessage('Categoría inválida'),
  
  body('porcentaje')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('El porcentaje debe ser un número positivo'),
  
  body('valor_fijo')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('El valor fijo debe ser un número positivo'),
  
  body('es_valor_fijo')
    .optional()
    .isBoolean()
    .withMessage('es_valor_fijo debe ser un booleano')
];

// Rutas principales
router.get('/', TipoRecargoController.obtenerTodos);
router.get('/categorias', TipoRecargoController.obtenerCategorias);
router.get('/por-categoria/:categoria', TipoRecargoController.obtenerPorCategoria);
router.post('/calcular-valor', TipoRecargoController.calcularValor);

router.get('/:id', [
  param('id').isUUID().withMessage('ID inválido')
], TipoRecargoController.obtenerPorId);

router.post('/', validacionesTipoRecargo, TipoRecargoController.crear);

router.put('/:id', [
  param('id').isUUID().withMessage('ID inválido'),
  ...validacionesTipoRecargo.filter(v => v.field !== 'codigo') // No validar código en actualización
], TipoRecargoController.actualizar);

router.delete('/:id', [
  param('id').isUUID().withMessage('ID inválido')
], TipoRecargoController.eliminar);

router.put('/:id/activar', [
  param('id').isUUID().withMessage('ID inválido')
], TipoRecargoController.activar);

module.exports = router;