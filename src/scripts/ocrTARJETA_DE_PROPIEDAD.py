import json
import re
import unicodedata
import sys

# Función para normalizar texto
def normalize_text(text):
    return unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('utf-8').upper()

# Clase principal para procesar la tarjeta de propiedad
class TarjetaPropiedadProcessor:
    def __init__(self, ocr_data):
        self.data = ocr_data
        self.content = ocr_data.get('analyzeResult', {}).get('content', '')
        self.lines = self.content.split('\n')
        
        # Extraer también las palabras individuales si están disponibles
        self.words = []
        pages = ocr_data.get('analyzeResult', {}).get('pages', [])
        for page in pages:
            if 'words' in page:
                self.words.extend(page['words'])
        
        self.result = {}
    
    def find_word_by_content(self, keyword, normalize=True):
        """Encuentra una palabra por su contenido"""
        keyword_norm = normalize_text(keyword) if normalize else keyword
        for word in self.words:
            content = word.get('content', '')
            content_norm = normalize_text(content) if normalize else content
            if keyword_norm in content_norm:
                return word
        return None

    def is_valid_document(self):
        """Verificar si es una tarjeta de propiedad válida"""
        return "REPÚBLICA DE COLOMBIA" in self.content and "MINISTERIO DE TRANSPORTE" in self.content
    
    def find_line_index(self, keyword):
        """Encontrar el índice de la línea que contiene una palabra clave"""
        for i, line in enumerate(self.lines):
            if keyword in normalize_text(line):
                return i
        return -1
    
    def extract_placa(self):
        """Extraer la placa del vehículo"""
        placa_idx = self.find_line_index("PLACA")
        if placa_idx >= 0:
            # Buscar en esta línea y las siguientes
            for i in range(placa_idx, min(placa_idx + 3, len(self.lines))):
                match = re.search(r'[A-Z]{3}\d{3}', self.lines[i])
                if match:
                    self.result["placa"] = match.group(0)
                    return True
        return False
    
    def extract_marca(self):
        """Extraer la marca del vehículo"""
        marca_idx = self.find_line_index("MARCA")
        if marca_idx >= 0:
            line = self.lines[marca_idx]
            parts = line.split("MARCA")
            if len(parts) > 1:
                self.result["marca"] = parts[1].strip()
                return True
        return False
    
    def extract_linea(self):
        """Extraer la línea del vehículo"""
        linea_idx = -1
        # Buscar LÍNEA o LINEA
        for i, line in enumerate(self.lines):
            if "LÍNEA" in line or "LINEA" in line:
                linea_idx = i
                break
                
        if linea_idx >= 0:
            line = self.lines[linea_idx]
            parts = re.split(r'LÍNEA|LINEA', line)
            if len(parts) > 1:
                self.result["linea"] = parts[1].strip()
                return True
        return False
    
    def extract_modelo(self):
        """Extraer el modelo (año) del vehículo"""
        modelo_idx = self.find_line_index("MODELO")
        if modelo_idx >= 0:
            line = self.lines[modelo_idx]
            match = re.search(r'\b(19|20)\d{2}\b', line)
            if match:
                self.result["modelo"] = match.group(0)
                return True
                
        # Si no encuentra, buscar un patrón de año en todas las líneas
        for line in self.lines:
            match = re.search(r'\b(19|20)\d{2}\b', line)
            if match:
                self.result["modelo"] = match.group(0)
                return True
        return False
    
    def extract_color(self):
        """Extraer el color del vehículo"""
        color_idx = self.find_line_index("COLOR")
        if color_idx >= 0:
            line = self.lines[color_idx]
            parts = line.split("COLOR")
            if len(parts) > 1:
                self.result["color"] = parts[1].strip()
                return True
        return False
    
    def extract_clase_vehiculo(self):
        """Extraer la clase del vehículo"""
        clase_idx = self.find_line_index("CLASE DE VEHÍCULO")
        if clase_idx >= 0:
            line = self.lines[clase_idx]
            parts = line.split("CLASE DE VEHÍCULO")
            if len(parts) > 1:
                self.result["claseVehiculo"] = parts[1].strip()
                return True
                
        # Buscar clases de vehículo específicas
        clases_vehiculo = ["CAMIONETA", "CAMION", "MICROBUS", "BUS"]
        for line in self.lines:
            for clase in clases_vehiculo:
                if clase in line:
                    self.result["claseVehiculo"] = clase
                    return True
        return False

    
    
    def extract_carroceria_combustible(self):
        """Extraer tipo de carrocería y combustible"""
        # Buscar "TIPO CARROCERÍA" en las palabras individuales
        tipo_word = self.find_word_by_content("TIPO CARROCERÍA")
        
        if tipo_word:
            # Buscar la siguiente palabra (que debería ser el valor)
            tipo_offset = tipo_word.get('spans', [{}])[0].get('offset', 0)
            tipo_length = tipo_word.get('spans', [{}])[0].get('length', 0)
            
            # Encontrar la palabra que viene después por posición
            for word in self.words:
                word_offset = word.get('spans', [{}])[0].get('offset', 0)
                if word_offset > tipo_offset + tipo_length and "TIPO" not in word.get('content', ''):
                    self.result["tipoCarroceria"] = word.get('content', '').strip()
                    
                    # Verificar si contiene "DIESEL"
                    if "DIESEL" in word.get('content', ''):
                        if "DOBLE CABINA CON DIESEL" in word.get('content', ''):
                            self.result["tipoCarroceria"] = "DOBLE CABINA"
                            self.result["combustible"] = "DIESEL"
                        else:
                            self.result["combustible"] = "DIESEL"
                    break
        
        # Buscar explícitamente "DOBLE CABINA CON DIESEL"
        if "tipoCarroceria" not in self.result or "combustible" not in self.result:
            for word in self.words:
                if "DOBLE CABINA CON DIESEL" in word.get('content', ''):
                    self.result["tipoCarroceria"] = "DOBLE CABINA"
                    self.result["combustible"] = "DIESEL"
                    break
        
        # Buscar combustible en palabras
        if "combustible" not in self.result:
            combustible_word = self.find_word_by_content("COMBUSTIBLE")
            if combustible_word:
                # Similar a la lógica anterior, buscar la siguiente palabra
                offset = combustible_word.get('spans', [{}])[0].get('offset', 0)
                length = combustible_word.get('spans', [{}])[0].get('length', 0)
                
                for word in self.words:
                    word_offset = word.get('spans', [{}])[0].get('offset', 0)
                    if word_offset > offset + length:
                        self.result["combustible"] = word.get('content', '').strip()
                        break
        
        # Búsqueda de respaldo en el contenido completo
        if not self.result.get("tipoCarroceria") or not self.result.get("combustible"):
            # Buscar en todo el contenido
            if "DOBLE CABINA CON DIESEL" in self.content:
                self.result["tipoCarroceria"] = "DOBLE CABINA"
                self.result["combustible"] = "DIESEL"
            elif "DIESEL" in self.content and "tipoCarroceria" in self.result:
                self.result["combustible"] = "DIESEL"
            elif "GASOLINA" in self.content and "tipoCarroceria" in self.result:
                self.result["combustible"] = "GASOLINA"
        
        return "tipoCarroceria" in self.result or "combustible" in self.result
    
    def extract_motor(self):
        """Extraer número de motor"""
        motor_idx = self.find_line_index("NUMERO DE MOTOR")
        if motor_idx >= 0 and motor_idx < len(self.lines) - 1:
            # Buscar en las siguientes líneas
            for i in range(motor_idx + 1, min(motor_idx + 5, len(self.lines))):
                line = self.lines[i].strip().upper()
                # Reemplazar O por 0 en posibles números de serie
                line = re.sub(r'O', '0', line)
                
                # Patrón alfanumérico para número de motor
                match = re.search(r'\b[A-Z0-9]{2,}[A-Z0-9\s-]{4,}\b', line)
                if match and len(line) < 25:
                    self.result["numeroMotor"] = match.group(0)
                    return True
        return False
    
    def extract_vin_chasis(self):
        """Extraer VIN, número de serie y chasis"""
        # Buscar patrones específicos para VIN/chasis
        vin_pattern = r'\b[A-Z0-9]{17}\b'
        
        # Buscar VIN explícitamente
        vin_idx = self.find_line_index("VIN")
        if vin_idx >= 0:
            # Extraer VIN de la misma línea
            line = self.lines[vin_idx]
            match = re.search(vin_pattern, line)
            if match:
                self.result["vin"] = match.group(0)
        
        # Buscar CHASIS explícitamente
        chasis_idx = self.find_line_index("CHASIS")
        if chasis_idx >= 0:
            for i in range(chasis_idx, min(chasis_idx + 3, len(self.lines))):
                match = re.search(vin_pattern, self.lines[i])
                if match:
                    self.result["numeroChasis"] = match.group(0)
        
        # Buscar SERIE explícitamente
        serie_idx = self.find_line_index("SERIE")
        if serie_idx >= 0:
            for i in range(serie_idx, min(serie_idx + 3, len(self.lines))):
                match = re.search(vin_pattern, self.lines[i])
                if match:
                    self.result["numeroSerie"] = match.group(0)
        
        # Si encontramos VIN pero no chasis/serie, usar el mismo valor
        if "vin" in self.result:
            if "numeroChasis" not in self.result:
                self.result["numeroChasis"] = self.result["vin"]
            if "numeroSerie" not in self.result:
                self.result["numeroSerie"] = self.result["vin"]
                
        return "vin" in self.result or "numeroChasis" in self.result
    
    def extract_propietario(self):
        """Extraer nombre e identificación del propietario"""
        for i, line in enumerate(self.lines):
            # Buscar línea que contenga "PROPIETARIO:"
            if "PROPIETARIO:" in line:
                # Extraer todo después de "PROPIETARIO:"
                texto = line.split("PROPIETARIO:")[1].strip()
                
                # Quitar el texto de formato "APELLIDO(S) Y NOMBRE(S)"
                nombre = texto.replace("APELLIDO(S) Y NOMBRE(S)", "").strip()
                
                if nombre:
                    self.result["propietarioNombre"] = nombre
                    break
        
        # Buscar línea con IDENTIFICACION
        for line in self.lines:
            if "IDENTIFICACION" in line and "NIT" in line:
                match = re.search(r'NIT\s+(\d+)', line)
                if match:
                    self.result["propietarioIdentificacion"] = f"NIT {match.group(1)}"
                    break
        
        return "propietarioNombre" in self.result

    def extract_fecha_matricula(self):
        """Extraer fecha de matrícula"""
        # Intentar buscar con acento
        fecha_idx = self.find_line_index("FECHA MATRÍCULA")
        
        # Si no se encuentra, intentar sin acento
        if fecha_idx == -1:
            fecha_idx = self.find_line_index("FECHA MATRICULA")
        
        # Si todavía no se encuentra, buscar parcialmente
        if fecha_idx == -1:
            for i, line in enumerate(self.lines):
                if "FECHA" in line and ("MATR" in line):
                    fecha_idx = i
                    break
        
        # Si se encontró la línea con la etiqueta de fecha
        if fecha_idx >= 0:
            # Verificar si la fecha está en la misma línea
            line = self.lines[fecha_idx]
            match = re.search(r'(\d{2}/\d{2}/\d{4})', line)
            if match:
                fecha = match.group(1)
                # Convertir de DD/MM/YYYY a YYYY-MM-DD
                partes = fecha.split('/')
                if len(partes) == 3:
                    self.result["fechaMatricula"] = f"{partes[2]}-{partes[1]}-{partes[0]}"
                    return True
            
            # Si la fecha está en la siguiente línea
            elif fecha_idx + 1 < len(self.lines):
                next_line = self.lines[fecha_idx + 1].strip()
                match = re.search(r'(\d{2}/\d{2}/\d{4})', next_line)
                if match:
                    fecha = match.group(1)
                    # Convertir de DD/MM/YYYY a YYYY-MM-DD
                    partes = fecha.split('/')
                    if len(partes) == 3:
                        self.result["fechaMatricula"] = f"{partes[2]}-{partes[1]}-{partes[0]}"
                        return True
        
        return False

    def process(self):
        """Procesar todos los campos y devolver el resultado"""
        if not self.is_valid_document():
            return {"error": "No es una tarjeta de propiedad válida"}
        
        self.extract_placa()
        self.extract_marca()
        self.extract_linea()
        self.extract_modelo()
        self.extract_color()
        self.extract_clase_vehiculo()
        self.extract_carroceria_combustible()
        self.extract_motor()
        self.extract_vin_chasis()
        self.extract_propietario()
        self.extract_fecha_matricula()
        
        return self.result

# Función principal para procesar el OCR
def process_ocr_data(data):
    try:
        processor = TarjetaPropiedadProcessor(data)
        result = processor.process()
        return result
    except Exception as e:
        return {"error": str(e)}

# Ejecución principal
if __name__ == "__main__":
    try:
        # Leer datos del argumento o archivo
        if len(sys.argv) > 1:
            data = json.loads(sys.argv[1])
        else:
            with open('./src/utils/tempOcrDataTARJETA_DE_PROPIEDAD.json', 'r', encoding='utf-8') as file:
                data = json.load(file)
        
        # Procesar los datos
        result = process_ocr_data(data)
        
        # Imprimir resultado como JSON
        print(json.dumps(result, indent=4, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))