const { Municipio } = require('../models');

// Obtener todos los municipios
exports.obtenerTodos = async (req, res) => {
  try {
    const municipios = await Municipio.findAll();
    return res.status(200).json({
      success: true,
      data: municipios,
      total: municipios.length
    });
  } catch (error) {
    console.error('Error al obtener municipios:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener municipios',
      error: error.message
    });
  }
};

// Obtener un municipio por ID
exports.obtenerPorId = async (req, res) => {
  try {
    const { id } = req.params;
    
    const municipio = await Municipio.findByPk(id);
    
    if (!municipio) {
      return res.status(404).json({
        success: false,
        message: 'Municipio no encontrado'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: municipio
    });
  } catch (error) {
    console.error('Error al obtener el municipio:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener el municipio',
      error: error.message
    });
  }
};