const { TipoRecargo } = require('../models');
const { validationResult } = require('express-validator');

class TipoRecargoController {
  
  // GET /api/tipos-recargo - Obtener todos los tipos de recargo
  static async obtenerTodos(req, res) {
    try {
      const { 
        categoria, 
        activo = 'true', 
        page = 1, 
        limit = 50,
        ordenar_por = 'orden_calculo',
        orden = 'ASC'
      } = req.query;

      const where = {};
      
      // Filtros
      if (categoria) {
        where.categoria = categoria;
      }
      
      if (activo !== 'all') {
        where.activo = activo === 'true';
      }

      // Configurar paginación
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const { count, rows } = await TipoRecargo.findAndCountAll({
        where,
        order: [[ordenar_por, orden.toUpperCase()]],
        limit: parseInt(limit),
        offset,
        attributes: [
          'id', 'codigo', 'nombre', 'descripcion', 'categoria', 'subcategoria',
          'porcentaje', 'adicional', 'es_valor_fijo', 'valor_fijo', 'aplica_festivos',
          'aplica_domingos', 'aplica_nocturno', 'aplica_diurno', 'orden_calculo',
          'es_hora_extra', 'requiere_horas_extras', 'limite_horas_diarias',
          'activo', 'vigencia_desde', 'vigencia_hasta', 'createdAt', 'updatedAt'
        ]
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
        },
        metadata: {
          filtros_aplicados: { categoria, activo },
          ordenamiento: { campo: ordenar_por, direccion: orden }
        }
      });

    } catch (error) {
      console.error('Error obteniendo tipos de recargo:', error);
      res.status(500).json({
        success: false,
        message: 'Error interno del servidor',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // GET /api/tipos-recargo/categorias - Obtener todas las categorías disponibles
  static async obtenerCategorias(req, res) {
    try {
      const categorias = await TipoRecargo.findAll({
        attributes: ['categoria'],
        group: ['categoria'],
        where: { activo: true },
        order: [['categoria', 'ASC']]
      });

      const categoriasFormateadas = categorias.map(cat => ({
        codigo: cat.categoria,
        nombre: cat.categoria.replace(/_/g, ' ').toLowerCase()
          .replace(/\b\w/g, l => l.toUpperCase())
      }));

      res.status(200).json({
        success: true,
        data: categoriasFormateadas
      });

    } catch (error) {
      console.error('Error obteniendo categorías:', error);
      res.status(500).json({
        success: false,
        message: 'Error obteniendo categorías',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // GET /api/tipos-recargo/por-categoria/:categoria - Obtener tipos por categoría
  static async obtenerPorCategoria(req, res) {
    try {
      const { categoria } = req.params;
      const { activo = 'true' } = req.query;

      const where = { categoria };
      if (activo !== 'all') {
        where.activo = activo === 'true';
      }

      const tipos = await TipoRecargo.findAll({
        where,
        order: [['orden_calculo', 'ASC']],
        attributes: [
          'id', 'codigo', 'nombre', 'descripcion', 'porcentaje',
          'es_valor_fijo', 'valor_fijo', 'orden_calculo', 'activo'
        ]
      });

      res.status(200).json({
        success: true,
        data: tipos,
        metadata: {
          categoria,
          total: tipos.length
        }
      });

    } catch (error) {
      console.error('Error obteniendo tipos por categoría:', error);
      res.status(500).json({
        success: false,
        message: 'Error obteniendo tipos por categoría',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // GET /api/tipos-recargo/:id - Obtener un tipo específico
  static async obtenerPorId(req, res) {
    try {
      const { id } = req.params;

      const tipo = await TipoRecargo.findByPk(id, {
        include: [
          {
            model: req.app.get('models').Usuario,
            as: 'creadoPor',
            attributes: ['id', 'nombre', 'email']
          }
        ]
      });

      if (!tipo) {
        return res.status(404).json({
          success: false,
          message: 'Tipo de recargo no encontrado'
        });
      }

      res.status(200).json({
        success: true,
        data: tipo
      });

    } catch (error) {
      console.error('Error obteniendo tipo de recargo:', error);
      res.status(500).json({
        success: false,
        message: 'Error obteniendo tipo de recargo',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // POST /api/tipos-recargo - Crear nuevo tipo de recargo
  static async crear(req, res) {
    try {
      // Validar errores de entrada
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Errores de validación',
          errors: errors.array()
        });
      }

      const {
        codigo, nombre, descripcion, categoria, subcategoria,
        porcentaje, es_valor_fijo, valor_fijo, aplica_festivos,
        aplica_domingos, aplica_nocturno, aplica_diurno,
        es_hora_extra, requiere_horas_extras, limite_horas_diarias
      } = req.body;

      // Verificar que el código no exista
      const tipoExistente = await TipoRecargo.findOne({ where: { codigo } });
      if (tipoExistente) {
        return res.status(409).json({
          success: false,
          message: `Ya existe un tipo de recargo con el código: ${codigo}`
        });
      }

      // Obtener el siguiente orden de cálculo
      const maxOrden = await TipoRecargo.max('orden_calculo') || 0;

      const nuevoTipo = await TipoRecargo.create({
        codigo: codigo.toUpperCase(),
        nombre,
        descripcion,
        categoria,
        subcategoria,
        porcentaje: porcentaje || 0,
        es_valor_fijo: es_valor_fijo || false,
        valor_fijo: es_valor_fijo ? valor_fijo : null,
        aplica_festivos,
        aplica_domingos,
        aplica_nocturno,
        aplica_diurno,
        orden_calculo: maxOrden + 1,
        es_hora_extra: es_hora_extra || false,
        requiere_horas_extras: requiere_horas_extras || false,
        limite_horas_diarias,
        vigencia_desde: new Date(),
        creado_por_id: req.user?.id
      });

      res.status(201).json({
        success: true,
        message: 'Tipo de recargo creado exitosamente',
        data: nuevoTipo
      });

    } catch (error) {
      console.error('Error creando tipo de recargo:', error);
      res.status(500).json({
        success: false,
        message: 'Error creando tipo de recargo',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // PUT /api/tipos-recargo/:id - Actualizar tipo de recargo
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

      // Remover campos que no se deben actualizar directamente
      delete updateData.id;
      delete updateData.codigo; // El código no se puede cambiar
      delete updateData.createdAt;
      delete updateData.updatedAt;

      const [affectedRows] = await TipoRecargo.update(updateData, {
        where: { id }
      });

      if (affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Tipo de recargo no encontrado'
        });
      }

      const tipoActualizado = await TipoRecargo.findByPk(id);

      res.status(200).json({
        success: true,
        message: 'Tipo de recargo actualizado exitosamente',
        data: tipoActualizado
      });

    } catch (error) {
      console.error('Error actualizando tipo de recargo:', error);
      res.status(500).json({
        success: false,
        message: 'Error actualizando tipo de recargo',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // DELETE /api/tipos-recargo/:id - Eliminar (desactivar) tipo de recargo
  static async eliminar(req, res) {
    try {
      const { id } = req.params;

      const tipo = await TipoRecargo.findByPk(id);
      if (!tipo) {
        return res.status(404).json({
          success: false,
          message: 'Tipo de recargo no encontrado'
        });
      }

      // Soft delete - desactivar en lugar de eliminar
      await tipo.update({ 
        activo: false, 
        vigencia_hasta: new Date() 
      });

      res.status(200).json({
        success: true,
        message: 'Tipo de recargo desactivado exitosamente'
      });

    } catch (error) {
      console.error('Error eliminando tipo de recargo:', error);
      res.status(500).json({
        success: false,
        message: 'Error eliminando tipo de recargo',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // PUT /api/tipos-recargo/:id/activar - Reactivar tipo de recargo
  static async activar(req, res) {
    try {
      const { id } = req.params;

      const tipo = await TipoRecargo.findByPk(id);
      if (!tipo) {
        return res.status(404).json({
          success: false,
          message: 'Tipo de recargo no encontrado'
        });
      }

      await tipo.update({ 
        activo: true, 
        vigencia_hasta: null 
      });

      res.status(200).json({
        success: true,
        message: 'Tipo de recargo activado exitosamente',
        data: tipo
      });

    } catch (error) {
      console.error('Error activando tipo de recargo:', error);
      res.status(500).json({
        success: false,
        message: 'Error activando tipo de recargo',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // POST /api/tipos-recargo/calcular-valor - Calcular valor de recargo
  static async calcularValor(req, res) {
    try {
      const { codigo_tipo, horas, valor_hora_base } = req.body;

      if (!codigo_tipo || !horas || !valor_hora_base) {
        return res.status(400).json({
          success: false,
          message: 'Faltan parámetros requeridos: codigo_tipo, horas, valor_hora_base'
        });
      }

      const tipo = await TipoRecargo.findOne({ 
        where: { codigo: codigo_tipo, activo: true } 
      });

      if (!tipo) {
        return res.status(404).json({
          success: false,
          message: `Tipo de recargo ${codigo_tipo} no encontrado o inactivo`
        });
      }

      let valorCalculado;
      if (tipo.es_valor_fijo) {
        valorCalculado = parseFloat(tipo.valor_fijo) * parseFloat(horas);
      } else {
        valorCalculado = (parseFloat(valor_hora_base) * parseFloat(tipo.porcentaje) / 100) * parseFloat(horas);
      }

      res.status(200).json({
        success: true,
        data: {
          tipo_recargo: {
            codigo: tipo.codigo,
            nombre: tipo.nombre,
            porcentaje: tipo.porcentaje,
            es_valor_fijo: tipo.es_valor_fijo,
            valor_fijo: tipo.valor_fijo
          },
          parametros: {
            horas: parseFloat(horas),
            valor_hora_base: parseFloat(valor_hora_base)
          },
          resultado: {
            valor_calculado: parseFloat(valorCalculado.toFixed(2)),
            valor_unitario: tipo.es_valor_fijo ? 
              parseFloat(tipo.valor_fijo) : 
              parseFloat((valor_hora_base * tipo.porcentaje / 100).toFixed(4))
          }
        }
      });

    } catch (error) {
      console.error('Error calculando valor de recargo:', error);
      res.status(500).json({
        success: false,
        message: 'Error calculando valor de recargo',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
}

module.exports = TipoRecargoController;