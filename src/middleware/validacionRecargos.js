const { TipoRecargo, ConfiguracionSalario } = require('../models');

// Middleware para verificar que existe el tipo de recargo
const verificarTipoRecargoExiste = async (req, res, next) => {
  try {
    const { codigo_tipo } = req.body;
    
    if (codigo_tipo) {
      const tipo = await TipoRecargo.findOne({ 
        where: { codigo: codigo_tipo, activo: true } 
      });
      
      if (!tipo) {
        return res.status(404).json({
          success: false,
          message: `Tipo de recargo ${codigo_tipo} no encontrado o inactivo`
        });
      }
      
      req.tipoRecargo = tipo;
    }
    
    next();
  } catch (error) {
    console.error('Error verificando tipo de recargo:', error);
    res.status(500).json({
      success: false,
      message: 'Error verificando tipo de recargo'
    });
  }
};

// Middleware para verificar configuración de salario vigente
const verificarConfigSalarioVigente = async (req, res, next) => {
  try {
    const { empresa_id } = req.query || req.body;
    
    const configuracion = await ConfiguracionSalario.findOne({
      where: {
        empresa_id: empresa_id || null,
        activo: true,
        vigencia_desde: { [Op.lte]: new Date() },
        [Op.or]: [
          { vigencia_hasta: null },
          { vigencia_hasta: { [Op.gte]: new Date() } }
        ]
      }
    });
    
    if (!configuracion) {
      return res.status(404).json({
        success: false,
        message: 'No se encontró configuración de salario vigente'
      });
    }
    
    req.configSalario = configuracion;
    next();
  } catch (error) {
    console.error('Error verificando configuración de salario:', error);
    res.status(500).json({
      success: false,
      message: 'Error verificando configuración de salario'
    });
  }
};

module.exports = {
  verificarTipoRecargoExiste,
  verificarConfigSalarioVigente
};
