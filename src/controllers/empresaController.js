// controllers/empresaController.js
const { Empresa } = require('../models');
const { Op } = require('sequelize');

// Obtener todas las empresas
exports.getEmpresas = async (req, res) => {
  try {
    const empresas = await Empresa.findAll({
      order: [['Nombre', 'ASC']]
    });
    
    return res.status(200).json({
      success: true,
      data: empresas
    });
  } catch (error) {
    console.error('Error al obtener empresas:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener empresas',
      error: error.message
    });
  }
};

// Obtener empresa por ID
exports.getEmpresaById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const empresa = await Empresa.findByPk(id);
    
    if (!empresa) {
      return res.status(404).json({
        success: false,
        message: 'Empresa no encontrada'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: empresa
    });
  } catch (error) {
    console.error('Error al obtener empresa por ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener empresa',
      error: error.message
    });
  }
};

// Obtener datos básicos de empresa
exports.getEmpresasBasicos = async (req, res) => {
  try {
    const empresasBasicos = await Empresa.findAll({
      attributes: ['id', 'NIT', 'Nombre'],
      order: [['Nombre', 'ASC']]
    });
    
    return res.status(200).json({
      success: true,
      data: empresasBasicos
    });
  } catch (error) {
    console.error('Error al obtener datos básicos de empresas:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener datos básicos de empresas',
      error: error.message
    });
  }
};

// Crear nueva empresa
exports.createEmpresa = async (req, res) => {
  try {
    const {
      NIT,
      Nombre,
      Representante,
      Cedula,
      Telefono,
      Direccion
    } = req.body;
    
    // Verificar si ya existe una empresa con el mismo NIT
    const empresaExistente = await Empresa.findOne({
      where: { NIT }
    });
    
    if (empresaExistente) {
      return res.status(400).json({
        success: false,
        message: `Ya existe una empresa con el NIT ${NIT}`
      });
    }
    
    // Crear la nueva empresa
    const nuevaEmpresa = await Empresa.create({
      NIT,
      Nombre,
      Representante,
      Cedula,
      Telefono,
      Direccion
    });
    
    return res.status(201).json({
      success: true,
      message: 'Empresa creada exitosamente',
      data: nuevaEmpresa
    });
  } catch (error) {
    console.error('Error al crear empresa:', error);
    
    // Manejo de errores de validación
    if (error.name === 'SequelizeValidationError') {
      const errores = error.errors.map(err => ({
        campo: err.path,
        mensaje: err.message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errores
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Error al crear empresa',
      error: error.message
    });
  }
};

// Actualizar empresa
exports.updateEmpresa = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      NIT,
      Nombre,
      Representante,
      Cedula,
      Telefono,
      Direccion
    } = req.body;
    
    // Verificar si la empresa existe
    const empresa = await Empresa.findByPk(id);
    
    if (!empresa) {
      return res.status(404).json({
        success: false,
        message: 'Empresa no encontrada'
      });
    }
    
    // Verificar si hay otra empresa con el mismo NIT (excepto la actual)
    if (NIT && NIT !== empresa.NIT) {
      const empresaExistente = await Empresa.findOne({
        where: {
          NIT,
          id: { [Op.ne]: id }
        }
      });
      
      if (empresaExistente) {
        return res.status(400).json({
          success: false,
          message: `Ya existe otra empresa con el NIT ${NIT}`
        });
      }
    }
    
    // Actualizar la empresa
    await empresa.update({
      NIT: NIT || empresa.NIT,
      Nombre: Nombre || empresa.Nombre,
      Representante: Representante || empresa.Representante,
      Cedula: Cedula || empresa.Cedula,
      Telefono: Telefono || empresa.Telefono,
      Direccion: Direccion || empresa.Direccion
    });
    
    return res.status(200).json({
      success: true,
      message: 'Empresa actualizada exitosamente',
      data: empresa
    });
  } catch (error) {
    console.error('Error al actualizar empresa:', error);
    
    // Manejo de errores de validación
    if (error.name === 'SequelizeValidationError') {
      const errores = error.errors.map(err => ({
        campo: err.path,
        mensaje: err.message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errores
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar empresa',
      error: error.message
    });
  }
};

// Eliminar empresa (soft delete)
exports.deleteEmpresa = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar si la empresa existe
    const empresa = await Empresa.findByPk(id);
    
    if (!empresa) {
      return res.status(404).json({
        success: false,
        message: 'Empresa no encontrada'
      });
    }
    
    // Eliminar la empresa (soft delete)
    await empresa.destroy();
    
    return res.status(200).json({
      success: true,
      message: 'Empresa eliminada exitosamente'
    });
  } catch (error) {
    console.error('Error al eliminar empresa:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al eliminar empresa',
      error: error.message
    });
  }
};

// Restaurar empresa eliminada
exports.restoreEmpresa = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Restaurar la empresa
    const result = await Empresa.restore({
      where: { id }
    });
    
    if (result === 0) {
      return res.status(404).json({
        success: false,
        message: 'Empresa no encontrada o ya está activa'
      });
    }
    
    const empresaRestaurada = await Empresa.findByPk(id);
    
    return res.status(200).json({
      success: true,
      message: 'Empresa restaurada exitosamente',
      data: empresaRestaurada
    });
  } catch (error) {
    console.error('Error al restaurar empresa:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al restaurar empresa',
      error: error.message
    });
  }
};

// Buscar empresas
exports.searchEmpresas = async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere un término de búsqueda'
      });
    }
    
    const empresas = await Empresa.findAll({
      where: {
        [Op.or]: [
          { NIT: { [Op.like]: `%${query}%` } },
          { Nombre: { [Op.like]: `%${query}%` } },
          { Representante: { [Op.like]: `%${query}%` } }
        ]
      },
      order: [['Nombre', 'ASC']]
    });
    
    return res.status(200).json({
      success: true,
      data: empresas
    });
  } catch (error) {
    console.error('Error al buscar empresas:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al buscar empresas',
      error: error.message
    });
  }
};