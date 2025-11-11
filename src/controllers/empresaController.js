// controllers/empresaController.js
const { Empresa, User } = require('../models');
const { Op } = require('sequelize');
const { notificarGlobal, notifyUser } = require('../utils/notificar');

// Obtener todas las empresas
exports.getEmpresas = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      sort = 'createdAt',
      order = 'DESC'
    } = req.query;

    const sequelizeOrder = order === 'ascending' ? 'ASC' : 'DESC';

    const whereClause = {};

    // Procesamiento de búsqueda general (busca en varios campos)
    if (search) {
      whereClause[Op.or] = [
        { nombre: { [Op.iLike]: `%${search}%` } },
        { nit: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // Si había filtros simples, intégralos también
    if (req.query.nombre) whereClause.nombre = { [Op.iLike]: `%${req.query.nombre}%` };

    const offset = (page - 1) * limit;

    // Determinación del ordenamiento
    let orderArray = [[sort, sequelizeOrder]];

    // Si el ordenamiento es por nombre completo (para mostrar nombre + apellido)
    if (sort === 'empresa') {
      orderArray = [['nombre', sequelizeOrder], ['nit', sequelizeOrder]];
    }

    const { count, rows } = await Empresa.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: orderArray,
      distinct: true  // Importante para contar correctamente con includes
    });

    res.status(200).json({
      success: true,
      count,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      data: rows
    });
  } catch (error) {
    console.error('Error al obtener empresas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener empresas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
    const empresas = await Empresa.findAll({
      attributes: ['id', 'nombre', 'nit'],
      order: [['nombre', 'ASC']]
    });

    const empresasOrdenados = empresas.sort((a, b) => a.nombre.localeCompare(b.nombre))

    return res.status(200).json({
      success: true,
      data: empresasOrdenados
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
      nit,
      nombre,
      representante,
      cedula,
      telefono,
      direccion,
      requiere_osi,
      paga_recargos
    } = req.body;

    // Verificar si ya existe una empresa con el mismo nit
    const empresaExistente = await Empresa.findOne({
      where: nit ? { nit } : { nit: null }
    });

    if (empresaExistente) {
      return res.status(400).json({
        success: false,
        message: `Ya existe una empresa con el nit ${nit}`
      });
    }

    // Crear la nueva empresa
    const nuevaEmpresa = await Empresa.create({
      nit,
      nombre,
      representante,
      cedula,
      telefono,
      direccion,
      requiere_osi,
      paga_recargos
    });

    const { id, nombre: usuarioNombre } = await User.findByPk(req.user.id);

    notificarGlobal('empresa:creado-global', {
      usuarioId: id,
      usuarioNombre,
      empresa: nuevaEmpresa,
    });

    notifyUser(id, 'empresa:creado', nuevaEmpresa)

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
      nit,
      nombre,
      representante,
      cedula,
      telefono,
      direccion,
      requiere_osi,
      paga_recargos
    } = req.body;

    // Verificar si la empresa existe
    const empresa = await Empresa.findByPk(id);

    if (!empresa) {
      return res.status(404).json({
        success: false,
        message: 'Empresa no encontrada'
      });
    }

    // Verificar si hay otra empresa con el mismo nit (excepto la actual)
    if (nit && nit !== empresa.nit) {
      const empresaExistente = await Empresa.findOne({
        where: {
          nit,
          id: { [Op.ne]: id }
        }
      });

      if (empresaExistente) {
        return res.status(400).json({
          success: false,
          message: `Ya existe otra empresa con el nit ${nit}`
        });
      }
    }

    // Actualizar la empresa
    const empresaActualizada = await empresa.update({
      nit: nit,
      nombre: nombre,
      representante,
      cedula,
      telefono,
      direccion,
      requiere_osi,
      paga_recargos
    });

    notificarGlobal('empresa:actualizado-global', {
      usuarioId: req.user.id,
      usuarioNombre: req.user.nombre,
      empresa: empresaActualizada,
    });

    notifyUser(req.user.id, 'empresa:actualizado', empresaActualizada)

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
          { nit: { [Op.like]: `%${query}%` } },
          { nombre: { [Op.like]: `%${query}%` } },
          { representante: { [Op.like]: `%${query}%` } }
        ]
      },
      order: [['nombre', 'ASC']]
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