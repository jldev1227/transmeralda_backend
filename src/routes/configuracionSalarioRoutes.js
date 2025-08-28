const express = require('express');
const { body, param } = require('express-validator');
const ConfiguracionSalarioController = require('../controllers/configuracionSalarioController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Middleware de autenticación
router.use(protect);

// Validaciones para configuración de salario
const validacionesConfigSalario = [
  body('salario_basico')
    .notEmpty()
    .withMessage('El salario básico es requerido')
    .isFloat({ min: 1 })
    .withMessage('El salario básico debe ser mayor a 0'),
  
  body('horas_mensuales_base')
    .optional()
    .isInt({ min: 1, max: 744 })
    .withMessage('Las horas mensuales deben estar entre 1 y 744'),
  
  body('vigencia_desde')
    .notEmpty()
    .withMessage('La fecha de vigencia es requerida')
    .isISO8601()
    .withMessage('La fecha debe tener formato válido (YYYY-MM-DD)'),
  
  body('empresa_id')
    .optional()
    .isUUID()
    .withMessage('ID de empresa inválido'),
  
  body('observaciones')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Las observaciones no pueden exceder 1000 caracteres')
];

// Rutas principales
router.get('/', ConfiguracionSalarioController.obtenerTodas);
router.get('/vigente', ConfiguracionSalarioController.obtenerVigente);
router.post('/calcular-valor-hora', ConfiguracionSalarioController.calcularValorHora);

router.get('/:id', [
  param('id').isUUID().withMessage('ID inválido')
], ConfiguracionSalarioController.obtenerPorId);

router.post('/', validacionesConfigSalario, ConfiguracionSalarioController.crear);

router.put('/:id', [
  param('id').isUUID().withMessage('ID inválido'),
  ...validacionesConfigSalario
], ConfiguracionSalarioController.actualizar);

router.delete('/:id', [
  param('id').isUUID().withMessage('ID inválido')
], ConfiguracionSalarioController.eliminar);

module.exports = router;