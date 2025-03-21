const { body, validationResult } = require('express-validator');

const validarCreacionConductor = [
  body('nombre').notEmpty().withMessage('El nombre es obligatorio'),
  body('apellido').notEmpty().withMessage('El apellido es obligatorio'),
  body('email').isEmail().withMessage('Correo electrónico inválido'),
  body('password').isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }
    next();
  }
];

const validarActualizacionConductor = [
  body('email').optional().isEmail().withMessage('Correo electrónico inválido'),
  body('password').optional().isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }
    next();
  }
];

module.exports = {
  validarCreacionConductor,
  validarActualizacionConductor
};