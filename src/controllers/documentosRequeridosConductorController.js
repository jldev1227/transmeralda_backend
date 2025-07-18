const { DocumentosRequeridosConductor } = require('../models');

class DocumentosRequeridosConductorController {
    // Obtener todos los documentos requeridos de conductores
    static async getAll(req, res) {
        try {
            const documentos = await DocumentosRequeridosConductor.findAll();
            res.status(200).json(documentos);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener documentos', error: error.message });
        }
    }

    // Obtener un documento requerido por ID
    static async getById(req, res) {
        try {
            const { id } = req.params;
            const documento = await DocumentosRequeridosConductor.findByPk({
                where: { id }
            });
            if (!documento) {
                return res.status(404).json({ message: 'Documento no encontrado' });
            }
            res.status(200).json(documento);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener el documento', error: error.message });
        }
    }

    // Crear un nuevo documento requerido
    static async create(req, res) {
        try {
            const data = req.body;
            const nuevoDocumento = await DocumentosRequeridosConductor.create(data);
            res.status(201).json(nuevoDocumento);
        } catch (error) {
            res.status(400).json({ message: 'Error al crear el documento', error: error.message });
        }
    }

    // Actualizar un documento requerido existente
    static async update(req, res) {
        try {
            const { id } = req.params;
            const data = req.body;
            const [updatedRowsCount] = await DocumentosRequeridosConductor.update(data, { where: { id } });
            const documentoActualizado = updatedRowsCount
                ? await DocumentosRequeridosConductor.findByPk(id)
                : null;
            if (!documentoActualizado) {
                return res.status(404).json({ message: 'Documento no encontrado' });
            }
            res.status(200).json(documentoActualizado);
        } catch (error) {
            res.status(400).json({ message: 'Error al actualizar el documento', error: error.message });
        }
    }

    // Eliminar un documento requerido
    static async delete(req, res) {
        try {
            const { id } = req.params;
            const eliminado = await DocumentosRequeridosConductor.destroy({
                where: { id }
            });
            if (!eliminado) {
                return res.status(404).json({ message: 'Documento no encontrado' });
            }
            res.status(204).send();
        } catch (error) {
            res.status(500).json({ message: 'Error al eliminar el documento', error: error.message });
        }
    }
}

// Asegúrate de exportar el controlador
module.exports = DocumentosRequeridosConductorController;