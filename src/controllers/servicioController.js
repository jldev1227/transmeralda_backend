const { Servicio, Municipio, Conductor, Vehiculo, Empresa } = require('../models');

// Obtener todos los servicios
exports.obtenerTodos = async (req, res) => {
  try {
    const servicios = await Servicio.findAll({
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre', 'apellido', 'numero_identificacion'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo'] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'Nombre'] }
      ]
    });
    
    return res.status(200).json({
      success: true,
      data: servicios,
      total: servicios.length
    });
  } catch (error) {
    console.error('Error al obtener servicios:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener servicios',
      error: error.message
    });
  }
};

// Obtener un servicio por ID
exports.obtenerPorId = async (req, res) => {
  try {
    const { id } = req.params;
    
    const servicio = await Servicio.findByPk(id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion']},
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo'] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'Nombre', 'NIT'] }
      ]
    });
    
    if (!servicio) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: servicio
    });
  } catch (error) {
    console.error('Error al obtener el servicio:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener el servicio',
      error: error.message
    });
  }
};

// Crear un nuevo servicio
exports.crear = async (req, res) => {
  console.log(req.body)
  try {
    const {
      origen_id,
      destino_id,
      origen_especifico,
      destino_especifico,
      origen_latitud,
      origen_longitud,
      destino_latitud,
      destino_longitud,
      conductor_id,
      vehiculo_id,
      cliente_id,
      estado,
      tipo_servicio,
      fecha_solicitud,
      fecha_realizacion,
      distancia_km,
      valor,
      observaciones
    } = req.body;

    // Validación adicional de datos, si es necesario
    if (!origen_id || !destino_id || !conductor_id || !vehiculo_id || !cliente_id) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos obligatorios para crear el servicio'
      });
    }
    
    // Verificar que existan los registros relacionados
    const [origen, destino, conductor, vehiculo, cliente] = await Promise.all([
      Municipio.findByPk(origen_id),
      Municipio.findByPk(destino_id),
      Conductor.findByPk(conductor_id),
      Vehiculo.findByPk(vehiculo_id),
      Empresa.findByPk(cliente_id)
    ]);

    if (!origen || !destino || !conductor || !vehiculo || !cliente) {
      return res.status(400).json({
        success: false,
        message: 'Uno o más de los IDs de referencia no existen en la base de datos'
      });
    }
    
    // Crear el servicio
    const nuevoServicio = await Servicio.create({
      origen_id,
      destino_id,
      origen_especifico,
      destino_especifico,
      origen_latitud,
      origen_longitud,
      destino_latitud,
      destino_longitud,
      conductor_id,
      vehiculo_id,
      cliente_id,
      estado: estado || 'planificado',
      tipo_servicio,
      fecha_solicitud,
      fecha_realizacion,
      distancia_km,
      valor,
      observaciones
    });
    
    // Obtener el servicio con sus relaciones
    const servicioCreado = await Servicio.findByPk(nuevoServicio.id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre', 'apellido', 'numero_identificacion'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'linea', 'modelo'] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'Nombre'] }
      ]
    });
    
    return res.status(201).json({
      success: true,
      message: 'Servicio creado exitosamente',
      data: servicioCreado
    });
  } catch (error) {
    console.error('Error al crear el servicio:', error);
    
    // Manejo específico de errores de validación de Sequelize
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errors: error.errors.map(e => ({
          field: e.path,
          message: e.message
        }))
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Error al crear el servicio',
      error: error.message
    });
  }
};

// Actualizar un servicio existente
exports.actualizar = async (req, res) => {
  console.log(req.body)
  try {
    const { id } = req.params;
    const {
      origen_id,
      destino_id,
      origen_especifico,
      destino_especifico,
      origen_latitud,
      origen_longitud,
      destino_latitud,
      destino_longitud,
      conductor_id,
      vehiculo_id,
      cliente_id,
      estado,
      tipo_servicio,
      fecha_solicitud,
      fecha_realizacion,
      distancia_km,
      valor,
      observaciones
    } = req.body;
    
    // Verificar que el servicio exista
    const servicio = await Servicio.findByPk(id);
    
    if (!servicio) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }
    
    // Si se cambiaron IDs de referencia, verificar que existan
    const promises = [];
    if (origen_id && origen_id !== servicio.origen_id) {
      promises.push(Municipio.findByPk(origen_id));
    }
    
    if (destino_id && destino_id !== servicio.destino_id) {
      promises.push(Municipio.findByPk(destino_id));
    }
    
    if (conductor_id && conductor_id !== servicio.conductor_id) {
      promises.push(Conductor.findByPk(conductor_id));
    }
    
    if (vehiculo_id && vehiculo_id !== servicio.vehiculo_id) {
      promises.push(Vehiculo.findByPk(vehiculo_id));
    }
    
    if (cliente_id && cliente_id !== servicio.cliente_id) {
      promises.push(Empresa.findByPk(cliente_id));
    }
    
    if (promises.length > 0) {
      const results = await Promise.all(promises);
      if (results.some(result => !result)) {
        return res.status(400).json({
          success: false,
          message: 'Uno o más de los IDs de referencia no existen en la base de datos'
        });
      }
    }
    
    // Actualizar el servicio
    await servicio.update({
      origen_id: origen_id || servicio.origen_id,
      destino_id: destino_id || servicio.destino_id,
      origen_especifico: origen_especifico || servicio.origen_especifico,
      destino_especifico: destino_especifico || servicio.destino_especifico,
      origen_latitud: origen_latitud !== undefined ? origen_latitud : servicio.origen_latitud,
      origen_longitud: origen_longitud !== undefined ? origen_longitud : servicio.origen_longitud,
      destino_latitud: destino_latitud !== undefined ? destino_latitud : servicio.destino_latitud,
      destino_longitud: destino_longitud !== undefined ? destino_longitud : servicio.destino_longitud,
      conductor_id: conductor_id || servicio.conductor_id,
      vehiculo_id: vehiculo_id || servicio.vehiculo_id,
      cliente_id: cliente_id || servicio.cliente_id,
      estado: estado || servicio.estado,
      tipo_servicio: tipo_servicio || servicio.tipo_servicio,
      fecha_solicitud: fecha_solicitud || servicio.fecha_solicitud,
      fecha_realizacion: fecha_realizacion || servicio.fecha_realizacion,
      distancia_km: distancia_km || servicio.distancia_km,
      valor: valor || servicio.valor,
      observaciones: observaciones !== undefined ? observaciones : servicio.observaciones
    });
    
    // Obtener el servicio actualizado con sus relaciones
    const servicioActualizado = await Servicio.findByPk(id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo'] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre'] }
      ]
    });
    
    return res.status(200).json({
      success: true,
      message: 'Servicio actualizado exitosamente',
      data: servicioActualizado
    });
  } catch (error) {
    console.error('Error al actualizar el servicio:', error);
    
    // Manejo específico de errores de validación de Sequelize
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errors: error.errors.map(e => ({
          field: e.path,
          message: e.message
        }))
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar el servicio',
      error: error.message
    });
  }
};

// Eliminar un servicio
exports.eliminar = async (req, res) => {
  try {
    const { id } = req.params;
    
    const servicio = await Servicio.findByPk(id);
    
    if (!servicio) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }
    
    // Opcionalmente, verificar dependencias antes de eliminar
    
    await servicio.destroy();
    
    return res.status(200).json({
      success: true,
      message: 'Servicio eliminado exitosamente',
      data: { id }
    });
  } catch (error) {
    console.error('Error al eliminar el servicio:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al eliminar el servicio',
      error: error.message
    });
  }
};

// Búsqueda avanzada de servicios
exports.buscarServicios = async (req, res) => {
  try {
    const { 
      estado, 
      tipo_servicio, 
      fecha_solicitud, 
      fecha_realizacion, 
      conductor_id, 
      cliente_id,
      origen_id,
      destino_id
    } = req.query;
    
    // Construir condiciones de búsqueda
    const where = {};
    
    if (estado) where.estado = estado;
    if (tipo_servicio) where.tipo_servicio = tipo_servicio;
    if (conductor_id) where.conductor_id = conductor_id;
    if (cliente_id) where.cliente_id = cliente_id;
    if (origen_id) where.origen_id = origen_id;
    if (destino_id) where.destino_id = destino_id;
    
    // Filtro de rango de fechas
    if (fecha_solicitud && fecha_realizacion) {
      where.fecha_solicitud = {
        [Op.between]: [new Date(fecha_solicitud), new Date(fecha_realizacion)]
      };
    } else if (fecha_solicitud) {
      where.fecha_solicitud = {
        [Op.gte]: new Date(fecha_solicitud)
      };
    } else if (fecha_realizacion) {
      where.fecha_solicitud = {
        [Op.lte]: new Date(fecha_realizacion)
      };
    }
    
    const servicios = await Servicio.findAll({
      where,
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo'] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre'] }
      ],
      order: [['fecha_solicitud', 'DESC']]
    });
    
    return res.status(200).json({
      success: true,
      data: servicios,
      total: servicios.length
    });
  } catch (error) {
    console.error('Error al buscar servicios:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al buscar servicios',
      error: error.message
    });
  }
};

// Cambiar estado de un servicio
exports.cambiarEstado = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    
    if (!estado || !['EN CURSO', 'COMPLETADO', 'PENDIENTE', 'REALIZADO', 'CANCELADO'].includes(estado)) {
      return res.status(400).json({
        success: false,
        message: 'Estado no válido'
      });
    }
    
    const servicio = await Servicio.findByPk(id);
    
    if (!servicio) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }
    
    // Actualizar solo el estado y registrar fecha de finalización si se completa
    const datosActualizacion = { estado };
    
    if (estado === 'COMPLETADO' || estado === 'REALIZADO') {
      datosActualizacion.fecha_realizacion = new Date();
    }
    
    await servicio.update(datosActualizacion);
    
    // Obtener el servicio actualizado
    const servicioActualizado = await Servicio.findByPk(id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre'] }
      ]
    });
    
    return res.status(200).json({
      success: true,
      message: `Servicio actualizado a estado ${estado}`,
      data: servicioActualizado
    });
  } catch (error) {
    console.error('Error al cambiar estado del servicio:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al cambiar estado del servicio',
      error: error.message
    });
  }
};