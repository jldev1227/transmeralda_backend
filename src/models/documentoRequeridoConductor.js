const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    class DocumentosRequeridosConductor extends Model { }

    DocumentosRequeridosConductor.init({
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        documento: {
            type: DataTypes.STRING(500),
            allowNull: false,
            comment: 'Nombre del documento o requerimiento'
        },
        es_obligatorio: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: 'Indica si el documento es obligatorio'
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: 'Indica si el documento está activo en el sistema'
        }
    }, {
        sequelize,
        modelName: 'DocumentosRequeridosConductor',
        tableName: 'documentos_requeridos_conductor',
        timestamps: true,
        createdAt: 'fecha_creacion',
        updatedAt: 'fecha_actualizacion',
        indexes: [
            {
                fields: ['activo']
            },
            {
                fields: ['es_obligatorio']
            }
        ]
    });

    return DocumentosRequeridosConductor;
};


// Función para insertar los datos iniciales
const insertarDocumentosIniciales = async (DocumentosRequeridosConductor) => {
    try {
        // Verificar si ya existen datos
        const count = await DocumentosRequeridosConductor.count();

        // Datos iniciales para insertar
        const documentosIniciales = [
            { documento: "Hoja de vida (Certificados formación y certificados experiencia laboral)", es_obligatorio: true },
            { documento: "Fotocopia CC 150%", es_obligatorio: true },
            { documento: "Libreta militar", es_obligatorio: true },
            { documento: "Fotocopia licencia 150%", es_obligatorio: true },
            { documento: "Certificado curso manejo defensivo", es_obligatorio: true },
            { documento: "Certificado curso mecánica básica", es_obligatorio: true },
            { documento: "Certificado curso primeros auxilios", es_obligatorio: true },
            { documento: "Certificado curso operador aula tipo planchón", es_obligatorio: true },
            { documento: "Certificado curso amarres y aparejos", es_obligatorio: true },
            { documento: "Certificado curso inspector vial", es_obligatorio: true },
            { documento: "Certificado curso trabajo en exteriores", es_obligatorio: true },
            { documento: "Certificado entrenamiento alturas nivel", es_obligatorio: true },
            { documento: "Certificado curso manejo sustancias peligrosas", es_obligatorio: true },
            { documento: "Certificado de residencia (certificado junta y certificado votación)", es_obligatorio: true },
            { documento: "Certificados antecedentes (policía, contraloría, procuraduría)", es_obligatorio: true },
            { documento: "Fotocopia CC 150% cónyuge", es_obligatorio: false },
            { documento: "Registro civil y/o tarjeta identidad hijos", es_obligatorio: false },
            { documento: "Carné vacunas (fiebre amarilla, tétano)", es_obligatorio: true },
            { documento: "Certificado vacunante", es_obligatorio: true },
            { documento: "Entrevista trabajo (prueba de conocimiento)", es_obligatorio: true },
            { documento: "Pruebas psicofísicas de Wartegg", es_obligatorio: true },
            { documento: "Ficha trabajador", es_obligatorio: true },
            { documento: "Concepto aptitud laboral", es_obligatorio: true },
            { documento: "Reevaluamiento otros resultados concepto aptitud laboral", es_obligatorio: false },
            { documento: "Contrato de trabajo", es_obligatorio: true },
            { documento: "Carta apertura de cuenta y/o certificado bancario", es_obligatorio: true },
            { documento: "Lista de chequeo inducción", es_obligatorio: true },
            { documento: "Evaluación inducción / reinducción", es_obligatorio: true },
            { documento: "Entrega dotación", es_obligatorio: true },
            { documento: "Afiliación ARL", es_obligatorio: true },
            { documento: "Afiliación y/o certificado EPS", es_obligatorio: true },
            { documento: "Certificado pensión", es_obligatorio: true }
        ];

        if (count === 0) {
            await DocumentosRequeridosConductor.bulkCreate(documentosIniciales);
            console.log('Documentos iniciales insertados correctamente');
        } else {
            console.log('Los documentos ya existen en la base de datos');
        }
    } catch (error) {
        console.error('Error al insertar documentos iniciales:', error);
    }
};

// Exportar también la función de inserción
module.exports.insertarDocumentosIniciales = insertarDocumentosIniciales;