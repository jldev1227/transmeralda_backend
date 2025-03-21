// src/controllers/vehiculoController.js
const { Vehiculo, Conductor } = require('../models');
const { Op } = require('sequelize');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Configuración de multer para almacenamiento de archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/vehiculos');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueFileName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueFileName);
  }
});

// Filtrar archivos permitidos
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Formato de archivo no válido. Solo se permiten JPEG, PNG y PDF.'), false);
  }
};

const upload = multer({ 
  storage, 
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // Limite de 5MB
});

// Obtener todos los vehículos
const getVehiculos = async (req, res) => {
  try {
    const { estado, marca, propietarioId } = req.query;
    
    const whereClause = {};
    
    if (estado) {
      whereClause.estado = estado;
    }
    
    if (marca) {
      whereClause.marca = { [Op.iLike]: `%${marca}%` };
    }
    
    if (propietarioId) {
      whereClause.propietarioId = propietarioId;
    }
    
    const vehiculos = await Vehiculo.findAll({
      where: whereClause,
      include: [
        { model: Conductor, as: 'conductor' }
      ]
    });
    
    return res.status(200).json({
      success: true,
      count: vehiculos.length,
      data: vehiculos
    });
  } catch (error) {
    console.error('Error al obtener vehículos:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener los vehículos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obtener un vehículo por ID
const getVehiculoById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const vehiculo = await Vehiculo.findByPk(id, {
      include: [
        { model: Usuario, as: 'propietario' },
        { model: Usuario, as: 'conductor' }
      ]
    });
    
    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }
    
    return res.status(200).json({
      success: true,
      vehiculo
    });
  } catch (error) {
    console.error('Error al obtener vehículo por ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener el vehículo',
      error: error.message
    });
  }
};

// Crear un nuevo vehículo
const createVehiculo = async (req, res) => {
  try {
    const vehiculoData = req.body;
    
    // Validar campos obligatorios
    const camposObligatorios = [
      'placa', 'marca', 'linea', 'modelo', 'color', 'claseVehiculo',
      'tipoCarroceria', 'combustible', 'numeroMotor', 'vin', 'numeroSerie',
      'numeroChasis', 'propietarioNombre', 'propietarioIdentificacion'
    ];
    
    const camposFaltantes = camposObligatorios.filter(campo => !vehiculoData[campo]);
    
    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Los siguientes campos son obligatorios: ${camposFaltantes.join(', ')}`
      });
    }
    
    // Verificar si ya existe un vehículo con la misma placa
    const vehiculoExistente = await Vehiculo.findOne({
      where: { placa: vehiculoData.placa }
    });
    
    if (vehiculoExistente) {
      return res.status(409).json({
        success: false,
        message: 'Ya existe un vehículo con esa placa'
      });
    }
    
    // Si se envían archivos en la solicitud (galería)
    if (req.files && req.files.length > 0) {
      const galeriaImagenes = req.files.map(file => file.path);
      vehiculoData.galeria = galeriaImagenes;
    }
    
    const nuevoVehiculo = await Vehiculo.create(vehiculoData);
    
    return res.status(201).json({
      success: true,
      message: 'Vehículo creado exitosamente',
      vehiculo: nuevoVehiculo
    });
  } catch (error) {
    console.error('Error al crear vehículo:', error);
    
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        success: false,
        message: 'La placa ya está registrada'
      });
    }
    
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errors: error.errors.map(e => e.message)
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Error al crear el vehículo',
      error: error.message
    });
  }
};

// Actualizar un vehículo existente
const updateVehiculo = async (req, res) => {
  try {
    const { id } = req.params;
    const vehiculoData = req.body;
    
    const vehiculo = await Vehiculo.findByPk(id);
    
    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }
    
    // Si se envían archivos nuevos para la galería
    if (req.files && req.files.length > 0) {
      // Obtener la galería actual y añadir las nuevas imágenes
      let galeriaActual = vehiculo.galeria || [];
      const nuevasImagenes = req.files.map(file => file.path);
      
      vehiculoData.galeria = [...galeriaActual, ...nuevasImagenes];
    }
    
    // Actualizar vehiculo con los nuevos datos
    await vehiculo.update(vehiculoData);
    
    return res.status(200).json({
      success: true,
      message: 'Vehículo actualizado exitosamente',
      vehiculo
    });
  } catch (error) {
    console.error('Error al actualizar vehículo:', error);
    
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        success: false,
        message: 'La placa ya está registrada para otro vehículo'
      });
    }
    
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errors: error.errors.map(e => e.message)
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar el vehículo',
      error: error.message
    });
  }
};

// Eliminar un vehículo
const deleteVehiculo = async (req, res) => {
  try {
    const { id } = req.params;
    
    const vehiculo = await Vehiculo.findByPk(id);
    
    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }
    
    // Eliminar archivos de galería si existen
    if (vehiculo.galeria && vehiculo.galeria.length > 0) {
      vehiculo.galeria.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    }
    
    await vehiculo.destroy();
    
    return res.status(200).json({
      success: true,
      message: 'Vehículo eliminado exitosamente'
    });
  } catch (error) {
    console.error('Error al eliminar vehículo:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al eliminar el vehículo',
      error: error.message
    });
  }
};

// Actualizar estado del vehículo
const updateEstadoVehiculo = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    
    if (!['DISPONIBLE', 'NO DISPONIBLE', 'MANTENIMIENTO', 'INACTIVO'].includes(estado)) {
      return res.status(400).json({
        success: false,
        message: 'Estado no válido. Use: DISPONIBLE, NO DISPONIBLE, MANTENIMIENTO o INACTIVO'
      });
    }
    
    const vehiculo = await Vehiculo.findByPk(id);
    
    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }
    
    await vehiculo.update({ estado });
    
    return res.status(200).json({
      success: true,
      message: `Estado del vehículo actualizado a ${estado}`,
      vehiculo
    });
  } catch (error) {
    console.error('Error al actualizar estado del vehículo:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar el estado del vehículo',
      error: error.message
    });
  }
};

// Actualizar ubicación del vehículo
const updateUbicacionVehiculo = async (req, res) => {
  try {
    const { id } = req.params;
    const { latitud, longitud } = req.body;
    
    if (!latitud || !longitud) {
      return res.status(400).json({
        success: false,
        message: 'Latitud y longitud son requeridas'
      });
    }
    
    const vehiculo = await Vehiculo.findByPk(id);
    
    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }
    
    await vehiculo.update({ latitud, longitud });
    
    return res.status(200).json({
      success: true,
      message: 'Ubicación del vehículo actualizada',
      vehiculo
    });
  } catch (error) {
    console.error('Error al actualizar ubicación del vehículo:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar la ubicación del vehículo',
      error: error.message
    });
  }
};

// Actualizar kilometraje del vehículo
const updateKilometrajeVehiculo = async (req, res) => {
  try {
    const { id } = req.params;
    const { kilometraje } = req.body;
    
    if (isNaN(kilometraje) || kilometraje < 0) {
      return res.status(400).json({
        success: false,
        message: 'El kilometraje debe ser un número positivo'
      });
    }
    
    const vehiculo = await Vehiculo.findByPk(id);
    
    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }
    
    await vehiculo.update({ kilometraje });
    
    return res.status(200).json({
      success: true,
      message: 'Kilometraje del vehículo actualizado',
      vehiculo
    });
  } catch (error) {
    console.error('Error al actualizar kilometraje del vehículo:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar el kilometraje del vehículo',
      error: error.message
    });
  }
};

// Eliminar imagen de la galería
const deleteGaleriaImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { imagePath } = req.body;
    
    if (!imagePath) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere la ruta de la imagen a eliminar'
      });
    }
    
    const vehiculo = await Vehiculo.findByPk(id);
    
    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }
    
    // Verificar si la imagen existe en la galería
    const galeriaActual = vehiculo.galeria || [];
    if (!galeriaActual.includes(imagePath)) {
      return res.status(404).json({
        success: false,
        message: 'Imagen no encontrada en la galería'
      });
    }
    
    // Eliminar archivo físico
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    
    // Actualizar galería en la base de datos
    const nuevaGaleria = galeriaActual.filter(img => img !== imagePath);
    await vehiculo.update({ galeria: nuevaGaleria });
    
    return res.status(200).json({
      success: true,
      message: 'Imagen eliminada de la galería',
      vehiculo
    });
  } catch (error) {
    console.error('Error al eliminar imagen de la galería:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al eliminar la imagen',
      error: error.message
    });
  }
};

// Asignar conductor al vehículo
const asignarConductor = async (req, res) => {
  try {
    const { id } = req.params;
    const { conductorId } = req.body;
    
    if (!conductorId) {
      return res.status(400).json({
        success: false,
        message: 'El ID del conductor es requerido'
      });
    }
    
    const vehiculo = await Vehiculo.findByPk(id);
    
    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }
    
    const conductor = await Usuario.findByPk(conductorId);
    
    if (!conductor) {
      return res.status(404).json({
        success: false,
        message: 'Conductor no encontrado'
      });
    }
    
    await vehiculo.update({ conductorId });
    
    return res.status(200).json({
      success: true,
      message: 'Conductor asignado exitosamente',
      vehiculo
    });
  } catch (error) {
    console.error('Error al asignar conductor:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al asignar el conductor',
      error: error.message
    });
  }
};

// Buscar vehículos por placa
const buscarVehiculosPorPlaca = async (req, res) => {
  try {
    const { placa } = req.query;
    
    if (!placa) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere una placa para la búsqueda'
      });
    }
    
    const vehiculos = await Vehiculo.findAll({
      where: {
        placa: {
          [Op.iLike]: `%${placa}%`
        }
      },
      include: [
        { model: Usuario, as: 'propietario' },
        { model: Usuario, as: 'conductor' }
      ]
    });
    
    return res.status(200).json({
      success: true,
      count: vehiculos.length,
      vehiculos
    });
  } catch (error) {
    console.error('Error al buscar vehículos por placa:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al buscar vehículos',
      error: error.message
    });
  }
};

// En el controlador del backend
const getVehiculosBasicos = async (req, res) => {
  try {
    const vehiculos = await Vehiculo.findAll({
      attributes: ['id', 'placa'], // Solo selecciona estos campos
      raw: true // Obtiene solo los datos planos, sin instancias de Sequelize
    });
    
    return res.status(200).json({
      success: true,
      count: vehiculos.length,
      data: vehiculos
    });
  } catch (error) {
    console.error('Error al obtener vehículos básicos:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener los vehículos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Middleware para manejar carga de archivos
const uploadGaleriaImages = upload.array('galeria', 10); // Máximo 10 imágenes

module.exports = {
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
  uploadGaleriaImages
};