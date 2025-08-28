const { ConfiguracionSalario, Empresa } = require('../models');
const { Op } = require('sequelize');

class ConfiguracionSalarioController {

  // GET /api/configuraciones-salario - Obtener todas las configuraciones
  static async obtenerTodas(req, res) {
    try {
      const { 
        empresa_id, 
        activo = 'true', 
        vigente = 'true',
        page = 1, 
        limit = 20 
      } = req.query;

      const where = {};
      
      if (empresa_id) {
        where.empresa_id = empresa_id;
      }
      
      if (activo !== 'all') {
        where.activo = activo === 'true';
      }

      // Filtro de vigencia
      if (vigente === 'true') {
        const ahora = new Date();
        where.vigencia_desde = { [Op.lte]: ahora };
        where[Op.or] = [
          { vigencia_hasta: null },
          { vigencia_hasta: { [Op.gte]: ahora } }
        ];
      }

      const offset = (parseInt(page) - 1) * parseInt(limit);

      const { count, rows } = await ConfiguracionSalario.findAndCountAll({
        where,
        include: [
          {
            model: Empresa,
            as: 'empresa',
            attributes: ['id', 'nombre', 'nit'],
            required: false
          }
        ],
        order: [['vigencia_desde', 'DESC']],
        limit: parseInt(limit),
        offset
      });

      const totalPages = Math.ceil(count / parseInt(limit));

      res.status(200).json({
        success: true,
        data: rows,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages,
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1
        }
      });

    } catch (error) {
      console.error('Error obteniendo configuraciones de salario:', error);
      res.status(500).json({
        success: false,
        message: 'Error obteniendo configuraciones de salario',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // GET /api/configuraciones-salario/vigente - Obtener configuración vigente
  static async obtenerVigente(req, res) {
    try {
      const { empresa_id } = req.query;
      const ahora = new Date();

      const where = {
        activo: true,
        vigencia_desde: { [Op.lte]: ahora },
        [Op.or]: [
          { vigencia_hasta: null },
          { vigencia_hasta: { [Op.gte]: ahora } }
        ]
      };

      // Buscar primero por empresa específica, luego configuración global
      if (empresa_id) {
        where.empresa_id = empresa_id;
      }

      let configuracion = await ConfiguracionSalario.findOne({
        where,
        include: [
          {
            model: Empresa,
            as: 'empresa',
            attributes: ['id', 'nombre', 'nit'],
            required: false
          }
        ],
        order: [['vigencia_desde', 'DESC']]
      });

      // Si no hay configuración específica para la empresa, buscar la global
      if (!configuracion && empresa_id) {
        const whereGlobal = { ...where };
        whereGlobal.empresa_id = null;
        
        configuracion = await ConfiguracionSalario.findOne({
          where: whereGlobal,
          order: [['vigencia_desde', 'DESC']]
        });
      }

      if (!configuracion) {
        return res.status(404).json({
          success: false,
          message: 'No se encontró configuración de salario vigente'
        });
      }

      res.status(200).json({
        success: true,
        data: configuracion
      });

    } catch (error) {
      console.error('Error obteniendo configuración vigente:', error);
      res.status(500).json({
        success: false,
        message: 'Error obteniendo configuración vigente',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // GET /api/configuraciones-salario/:id - Obtener configuración específica
  static async obtenerPorId(req, res) {
    try {
      const { id } = req.params;

      const configuracion = await ConfiguracionSalario.findByPk(id, {
        include: [
          {
            model: Empresa,
            as: 'empresa',
            attributes: ['id', 'nombre', 'nit']
          }
        ]
      });

      if (!configuracion) {
        return res.status(404).json({
          success: false,
          message: 'Configuración de salario no encontrada'
        });
      }

      res.status(200).json({
        success: true,
        data: configuracion
      });

    } catch (error) {
      console.error('Error obteniendo configuración:', error);
      res.status(500).json({
        success: false,
        message: 'Error obteniendo configuración',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // POST /api/configuraciones-salario - Crear nueva configuración
  static async crear(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Errores de validación',
          errors: errors.array()
        });
      }

      const {
        empresa_id,
        salario_basico,
        horas_mensuales_base = 240,
        vigencia_desde,
        observaciones
      } = req.body;

      // Calcular valor hora trabajador
      const valor_hora_trabajador = parseFloat(salario_basico) / parseInt(horas_mensuales_base);

      const nuevaConfiguracion = await ConfiguracionSalario.create({
        empresa_id,
        salario_basico: parseFloat(salario_basico),
        valor_hora_trabajador: parseFloat(valor_hora_trabajador.toFixed(4)),
        horas_mensuales_base: parseInt(horas_mensuales_base),
        vigencia_desde: new Date(vigencia_desde),
        observaciones,
        creado_por_id: req.user?.id
      });

      res.status(201).json({
        success: true,
        message: 'Configuración de salario creada exitosamente',
        data: nuevaConfiguracion
      });

    } catch (error) {
      console.error('Error creando configuración de salario:', error);
      res.status(500).json({
        success: false,
        message: 'Error creando configuración de salario',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // PUT /api/configuraciones-salario/:id - Actualizar configuración
  static async actualizar(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Errores de validación',
          errors: errors.array()
        });
      }

      const { id } = req.params;
      const updateData = { ...req.body };

      // Recalcular valor hora si se actualiza salario o horas
      if (updateData.salario_basico || updateData.horas_mensuales_base) {
        const config = await ConfiguracionSalario.findByPk(id);
        if (!config) {
          return res.status(404).json({
            success: false,
            message: 'Configuración no encontrada'
          });
        }

        const salario = updateData.salario_basico || config.salario_basico;
        const horas = updateData.horas_mensuales_base || config.horas_mensuales_base;
        updateData.valor_hora_trabajador = parseFloat((salario / horas).toFixed(4));
      }

      const [affectedRows] = await ConfiguracionSalario.update(updateData, {
        where: { id }
      });

      if (affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Configuración de salario no encontrada'
        });
      }

      const configActualizada = await ConfiguracionSalario.findByPk(id);

      res.status(200).json({
        success: true,
        message: 'Configuración actualizada exitosamente',
        data: configActualizada
      });

    } catch (error) {
      console.error('Error actualizando configuración:', error);
      res.status(500).json({
        success: false,
        message: 'Error actualizando configuración',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // DELETE /api/configuraciones-salario/:id - Desactivar configuración
  static async eliminar(req, res) {
    try {
      const { id } = req.params;

      const configuracion = await ConfiguracionSalario.findByPk(id);
      if (!configuracion) {
        return res.status(404).json({
          success: false,
          message: 'Configuración no encontrada'
        });
      }

      await configuracion.update({ 
        activo: false,
        vigencia_hasta: new Date()
      });

      res.status(200).json({
        success: true,
        message: 'Configuración desactivada exitosamente'
      });

    } catch (error) {
      console.error('Error desactivando configuración:', error);
      res.status(500).json({
        success: false,
        message: 'Error desactivando configuración',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // POST /api/configuraciones-salario/calcular-valor-hora - Calcular valor hora
  static async calcularValorHora(req, res) {
    try {
      const { salario_basico, horas_mensuales = 240 } = req.body;

      if (!salario_basico) {
        return res.status(400).json({
          success: false,
          message: 'El salario básico es requerido'
        });
      }

      const valorHora = parseFloat(salario_basico) / parseInt(horas_mensuales);

      res.status(200).json({
        success: true,
        data: {
          salario_basico: parseFloat(salario_basico),
          horas_mensuales: parseInt(horas_mensuales),
          valor_hora_trabajador: parseFloat(valorHora.toFixed(4))
        }
      });

    } catch (error) {
      console.error('Error calculando valor hora:', error);
      res.status(500).json({
        success: false,
        message: 'Error calculando valor hora',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
}

module.exports = ConfiguracionSalarioController;
