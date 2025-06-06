import json
import re
import unicodedata
import sys
import traceback
import os
import argparse

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
        content_upper = self.content.upper()
        
        # Palabras clave a buscar (sin tildes para mayor flexibilidad)
        keywords = [
            "REPUBLICA DE COLOMBIA",
            "REPÚBLICA DE COLOMBIA", 
            "MINISTERIO DE TRANSPORTE",
            "LICENCIA DE TRANSITO",
            "LICENCIA DE TRÁNSITO"
        ]
        
        return any(keyword in content_upper for keyword in keywords)
    
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
                marca_candidata = parts[1].strip()
                
                # Verificar si la marca no está vacía
                if marca_candidata:
                    self.result["marca"] = marca_candidata
                    return True
            
            # Si la marca está vacía o no se encontró en la misma línea,
            # buscar en la línea siguiente
            if marca_idx + 1 < len(self.lines):
                next_line = self.lines[marca_idx + 1].strip()
                
                if next_line:
                    self.result["marca"] = next_line
                    return True
    
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
                linea_candidata = parts[1].strip()
                
                # Verificar si la línea no está vacía
                if linea_candidata:
                    self.result["linea"] = linea_candidata
                    return True
            
            
            # Si la línea está vacía o no se encontró en la misma línea,
            # buscar en la línea siguiente
            if linea_idx + 1 < len(self.lines):
                next_line = self.lines[linea_idx + 1].strip()
                
                if next_line:
                    self.result["linea"] = next_line
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
            
            if len(parts) > 1 and parts[1].strip():
                # El color está en la misma línea después de "COLOR"
                self.result["color"] = parts[1].strip()
                return True
            elif color_idx + 1 < len(self.lines):
                # Si no hay contenido después de "COLOR" o está vacío, buscar en la siguiente línea
                next_line = self.lines[color_idx + 1].strip()
                if next_line:
                    self.result["color"] = next_line
                    return True
        
        return False
        
    def extract_clase_vehiculo(self):
        """Extraer la clase del vehículo"""
        clase_idx = self.find_line_index("CLASE DE VEHÍCULO")
        if clase_idx >= 0:
            line = self.lines[clase_idx]
            parts = line.split("CLASE DE VEHÍCULO")
            if len(parts) > 1:
                self.result["clase_vehiculo"] = parts[1].strip()
                return True
                
        # Buscar clases de vehículo específicas
        clases_vehiculo = ["CAMIONETA", "CAMION", "MICROBUS", "BUS"]
        for line in self.lines:
            for clase in clases_vehiculo:
                if clase in line:
                    self.result["clase_vehiculo"] = clase
                    return True
        return False
    
    def extract_carroceria_combustible(self):
        """Extraer tipo de carrocería y combustible"""
        
        # Establecer DIESEL como combustible por defecto
        self.result["combustible"] = "DIESEL"
        
        # Buscar tipo de carrocería en el contenido
        carroceria_tipos = {
            "CERRADA": "CERRADA",
            "DOBLE": "DOBLE CABINA",
            "ESTACAS": "ESTACAS"
        }
        
        # Buscar coincidencias en el contenido completo
        content_upper = self.content.upper()
        for keyword, tipo in carroceria_tipos.items():
            if keyword in content_upper:
                self.result["tipo_carroceria"] = tipo
                break
        
        # Si no encuentra en el contenido general, buscar con palabras específicas
        if "tipo_carroceria" not in self.result:
            # Buscar con diferentes variantes de la etiqueta
            tipo_word = None
            
            # Intentar diferentes variantes con y sin tildes
            search_terms = [
                "TIPO CARROCERÍA",
                "TIPO CARROCERIA", 
                "TIPO DE CARROCERÍA",
                "TIPO DE CARROCERIA",
                "CARROCERÍA",
                "CARROCERIA",
                "CLASE CARROCERÍA",
                "CLASE CARROCERIA",
                "BODY TYPE",
                "TIPO VEHICULO",
                "TIPO VEHÍCULO"
            ]
            
            for term in search_terms:
                tipo_word = self.find_word_by_content(term)
                if tipo_word:
                    break
            
            if tipo_word:
                # Buscar la siguiente palabra (que debería ser el valor)
                tipo_offset = tipo_word.get('spans', [{}])[0].get('offset', 0)
                tipo_length = tipo_word.get('spans', [{}])[0].get('length', 0)
                
                # Encontrar la palabra que viene después por posición
                for word in self.words:
                    word_offset = word.get('spans', [{}])[0].get('offset', 0)
                    if word_offset > tipo_offset + tipo_length and "TIPO" not in word.get('content', ''):
                        content = word.get('content', '').strip().upper()
                        
                        # Verificar si contiene alguna de las palabras clave
                        for keyword, tipo in carroceria_tipos.items():
                            if keyword in content:
                                self.result["tipo_carroceria"] = tipo
                                break
                        
                        # Si no encuentra palabras clave específicas, usar el contenido original
                        if "tipo_carroceria" not in self.result:
                            self.result["tipo_carroceria"] = word.get('content', '').strip()
                        break
        
        # Buscar explícitamente patrones específicos en las palabras
        if "tipo_carroceria" not in self.result:
            for word in self.words:
                content = word.get('content', '').upper()
                
                # Buscar patrones específicos
                if "DOBLE CABINA" in content:
                    self.result["tipo_carroceria"] = "DOBLE CABINA"
                    break
                elif "CERRADA" in content:
                    self.result["tipo_carroceria"] = "CERRADA"
                    break
                elif "ESTACAS" in content:
                    self.result["tipo_carroceria"] = "ESTACAS"
                    break
                elif "DOBLE" in content and "CABINA" in content:
                    self.result["tipo_carroceria"] = "DOBLE CABINA"
                    break
        
        # Buscar combustible específico si hay una etiqueta COMBUSTIBLE
        combustible_word = self.find_word_by_content("COMBUSTIBLE")
        if combustible_word:
            # Obtener información de la palabra encontrada
            span_info = combustible_word.get('span', {}) or combustible_word.get('spans', [{}])[0]
            offset = span_info.get('offset', 0)
            length = span_info.get('length', 0)
            
            # Lista de combustibles válidos para validar (más específica)
            combustibles_validos = {
                'DIESEL': 'DIESEL',
                'DIÉSEL': 'DIESEL', 
                'GASOLINA': 'GASOLINA',
                'ACPM': 'ACPM',
                'GAS NATURAL': 'GAS NATURAL',
                'GNC': 'GAS NATURAL',
                'GNL': 'GAS NATURAL',
                'GLP': 'GAS NATURAL',
                'BIODIÉSEL': 'BIODIESEL',
                'BIODIESEL': 'BIODIESEL',
                'ELECTRICO': 'ELECTRICO',
                'ELÉCTRICO': 'ELECTRICO',
                'HIBRIDO': 'HIBRIDO',
                'HÍBRIDO': 'HIBRIDO',
                'ETANOL': 'ETANOL'
            }
            
            # Buscar las siguientes palabras después de "COMBUSTIBLE"
            next_words = []
            for word in self.words:
                word_span = word.get('span', {}) or word.get('spans', [{}])[0]
                word_offset = word_span.get('offset', 0)
                
                # Si la palabra está después de "COMBUSTIBLE"
                if word_offset > offset + length:
                    content = word.get('content', '').strip().upper()
                    next_words.append({
                        'content': content,
                        'offset': word_offset,
                        'word': word
                    })
            
            # Ordenar por offset para obtener las palabras en orden
            next_words.sort(key=lambda x: x['offset'])
            
            # Buscar combustible válido en las siguientes palabras
            for next_word in next_words[:5]:  # Revisar hasta 5 palabras siguientes
                content = next_word['content']
                
                # Verificar si es un combustible válido exacto o contiene uno
                for combustible_key, combustible_value in combustibles_validos.items():
                    # Buscar coincidencia exacta o que contenga el combustible
                    if (content == combustible_key or 
                        (len(combustible_key) > 3 and combustible_key in content) or
                        (len(content) > 3 and content in combustible_key)):
                        
                        self.result["combustible"] = combustible_value
                        return True
                
                # Evitar palabras de una sola letra o muy cortas que puedan ser ruido
                if len(content) <= 2:
                    continue
                    
                # Si encuentra "DIESEL" explícitamente en el texto
                if "DIESEL" in content:
                    self.result["combustible"] = "DIESEL"
                    return True
        
        # Verificar si hay indicios de otros combustibles en el contenido completo y cambiar si es necesario
        content_upper = self.content.upper()
        
        # Solo cambiar el combustible si hay evidencia clara de otro tipo
        if "GASOLINA" in content_upper and "DIESEL" not in content_upper:
            self.result["combustible"] = "GASOLINA"
        elif "GAS NATURAL" in content_upper or "GNC" in content_upper:
            self.result["combustible"] = "GAS NATURAL"
        elif "ELECTRICO" in content_upper or "ELÉCTRICO" in content_upper:
            self.result["combustible"] = "ELECTRICO"
        elif "HIBRIDO" in content_upper or "HÍBRIDO" in content_upper:
            self.result["combustible"] = "HIBRIDO"
        
        return "tipo_carroceria" in self.result or "combustible" in self.result
            

    def extract_motor(self):
        """Extraer número de motor"""
        # Buscar con diferentes variantes de la etiqueta
        motor_idx = -1
        
        # Intentar diferentes variantes con y sin tildes
        search_terms = [
            "NÚMERO DE MOTOR",
            "NUMERO DE MOTOR", 
            "NUM DE MOTOR",
            "NÚM DE MOTOR",
            "MOTOR",
            "ENGINE"
        ]
        
        for term in search_terms:
            motor_idx = self.find_line_index(term)
            if motor_idx >= 0:
                break
        
        # Si todavía no se encuentra, buscar parcialmente
        if motor_idx == -1:
            for i, line in enumerate(self.lines):
                line_upper = line.upper()
                if ("NUMERO" in line_upper or "NÚMERO" in line_upper) and "MOTOR" in line_upper:
                    motor_idx = i
                    break
        
        if motor_idx >= 0:
            # Buscar en la misma línea y las siguientes líneas
            for i in range(motor_idx, min(motor_idx + 6, len(self.lines))):
                line = self.lines[i].strip().upper()
                
                # Reemplazar O por 0 en posibles números de serie
                line_cleaned = re.sub(r'O', '0', line)
                
                # Si estamos en la línea de la etiqueta, buscar después de la etiqueta
                if i == motor_idx:
                    # Buscar el número después de la etiqueta en la misma línea
                    for term in search_terms:
                        if term in line:
                            # Extraer la parte después de la etiqueta
                            parts = line.split(term, 1)
                            if len(parts) > 1:
                                remaining_line = parts[1].strip()
                                if remaining_line:
                                    # Buscar patrón alfanumérico en la parte restante
                                    match = re.search(r'\b[A-Z0-9]{2,}[A-Z0-9\s-]{4,}\b', remaining_line)
                                    if match and len(remaining_line) < 25:
                                        motor_number = match.group(0).strip()
                                        self.result["numero_motor"] = motor_number
                                        return True
                else:
                    # Para líneas siguientes, buscar el patrón directamente
                    # Patrón alfanumérico para número de motor
                    patterns = [
                        r'\b[A-Z0-9]{2,}[A-Z0-9\s-]{4,}\b',  # Patrón original
                        r'\b[A-Z0-9]{6,}\b',                   # Secuencia alfanumérica de al menos 6 caracteres
                        r'\b[A-Z]{2,}[0-9]{4,}\b',            # Letras seguidas de números
                        r'\b[0-9]{2,}[A-Z]{2,}[0-9]{2,}\b',   # Números-Letras-Números
                    ]
                    
                    for pattern in patterns:
                        match = re.search(pattern, line_cleaned)
                        if match and len(line) < 30:  # Línea no muy larga
                            motor_number = match.group(0).strip()

                            if self.validate_motor_number(motor_number):
                                self.result["numero_motor"] = motor_number
                                return True
        
        return False
    
    def validate_motor_number(self, motor_number):
        """Validar si un número de motor es válido"""
        # Evitar strings demasiado cortos o largos
        if not motor_number or len(motor_number) < 4 or len(motor_number) > 20:
            return False
        
        # Debe contener al menos un número y una letra
        has_letter = any(c.isalpha() for c in motor_number)
        has_number = any(c.isdigit() for c in motor_number)
        
        if not (has_letter and has_number):
            return False
        
        # Evitar palabras comunes que no son números de motor
        invalid_words = [
            'NUMERO', 'MOTOR', 'ENGINE', 'SERIAL', 'TIPO', 'MODELO',
            'MARCA', 'YEAR', 'COMBUSTIBLE', 'DIESEL', 'GASOLINA'
        ]
        
        motor_upper = motor_number.upper()
        for invalid in invalid_words:
            if invalid in motor_upper:
                return False
        
        # Evitar secuencias de solo números o solo letras muy largas
        if motor_number.isdigit() and len(motor_number) > 10:
            return False
        
        if motor_number.isalpha() and len(motor_number) > 8:
            return False
        
        return True

    def extract_vin_chasis(self):
        """Extraer VIN, número de serie y chasis"""
        # Patrón para VIN (17 caracteres alfanuméricos)
        vin_pattern = r'\b[A-Z0-9]{17}\b'
        
        # Buscar VIN explícitamente
        vin_idx = self.find_line_index("VIN")
        if vin_idx >= 0:
            # Buscar en la misma línea y las siguientes
            for i in range(vin_idx, min(vin_idx + 5, len(self.lines))):
                line = self.lines[i].strip().upper()
                # Reemplazar O por 0 en posibles VINs
                line = re.sub(r'O', '0', line)
                
                match = re.search(vin_pattern, line)
                if match:
                    self.result["vin"] = match.group(0)
                    break
        
        # Buscar CHASIS explícitamente
        chasis_idx = self.find_line_index("CHASIS")
        if chasis_idx >= 0:
            # Buscar en la misma línea y las siguientes
            for i in range(chasis_idx, min(chasis_idx + 5, len(self.lines))):
                line = self.lines[i].strip().upper()
                # Reemplazar O por 0 en posibles números de chasis
                line = re.sub(r'O', '0', line)
                
                match = re.search(vin_pattern, line)
                if match:
                    self.result["numero_chasis"] = match.group(0)
                    break
        
        # Buscar SERIE explícitamente
        serie_idx = self.find_line_index("SERIE")
        if serie_idx >= 0:
            # Buscar en la misma línea y las siguientes
            for i in range(serie_idx, min(serie_idx + 5, len(self.lines))):
                line = self.lines[i].strip().upper()
                # Reemplazar O por 0 en posibles números de serie
                line = re.sub(r'O', '0', line)
                
                match = re.search(vin_pattern, line)
                if match:
                    self.result["numero_serie"] = match.group(0)
                    break
        
        # Buscar también por "NUMERO DE CHASIS" y "NUMERO DE SERIE" (más específico)
        numero_chasis_idx = self.find_line_index("NUMERO DE CHASIS")
        if numero_chasis_idx >= 0 and "numero_chasis" not in self.result:
            for i in range(numero_chasis_idx, min(numero_chasis_idx + 5, len(self.lines))):
                line = self.lines[i].strip().upper()
                line = re.sub(r'O', '0', line)
                
                match = re.search(vin_pattern, line)
                if match:
                    self.result["numero_chasis"] = match.group(0)
                    break
        
        numero_serie_idx = self.find_line_index("NUMERO DE SERIE")
        if numero_serie_idx >= 0 and "numero_serie" not in self.result:
            for i in range(numero_serie_idx, min(numero_serie_idx + 5, len(self.lines))):
                line = self.lines[i].strip().upper()
                line = re.sub(r'O', '0', line)
                
                match = re.search(vin_pattern, line)
                if match:
                    self.result["numero_serie"] = match.group(0)
                    break
        
        # Si encontramos VIN pero no chasis/serie, usar el mismo valor
        if "vin" in self.result:
            if "numero_chasis" not in self.result:
                self.result["numero_chasis"] = self.result["vin"]
            if "numero_serie" not in self.result:
                self.result["numero_serie"] = self.result["vin"]
        
        return "vin" in self.result or "numero_chasis" in self.result or "numero_serie" in self.result
    
    def extract_propietario(self):
        """Extraer nombre e identificación del propietario"""
        
        propietario_index = -1
        
        # Buscar nombre del propietario y guardar el índice
        for i, line in enumerate(self.lines):
            # Buscar línea que contenga "PROPIETARIO:"
            if "PROPIETARIO:" in line:
                # Extraer todo después de "PROPIETARIO:"
                texto = line.split("PROPIETARIO:")[1].strip()
                
                # Quitar el texto de formato "APELLIDO(S) Y NOMBRE(S)"
                nombre = texto.replace("APELLIDO(S) Y NOMBRE(S)", "").strip()
                
                if nombre:
                    self.result["propietario_nombre"] = nombre
                    propietario_index = i  # Guardar el índice donde se encontró el propietario
                    break
                else:
                    # Si el nombre está vacío, buscar en la línea siguiente
                    if i + 1 < len(self.lines):
                        next_line = self.lines[i + 1].strip()
                        if next_line:
                            self.result["propietario_nombre"] = next_line
                            propietario_index = i + 1  # Guardar el índice de la línea siguiente
                            break
        
        # Si encontramos el propietario, buscar identificación desde ese punto hacia adelante
        if propietario_index >= 0:
            # Buscar identificación solo después del índice del propietario
            for i in range(propietario_index + 1, len(self.lines)):
                line = self.lines[i]
                
                # Buscar NIT directamente
                nit_match = re.search(r'NIT\s+(\d+)', line, re.IGNORECASE)
                if nit_match:
                    nit = f"NIT {nit_match.group(1)}"
                    self.result["propietario_identificacion"] = nit
                    return True
                
                # Buscar C.C directamente
                cc_match = re.search(r'C\.?C\.?\s+(\d+)', line, re.IGNORECASE)
                if cc_match:
                    cc = f"CC {cc_match.group(1)}"
                    self.result["propietario_identificacion"] = cc
                    return True
                
                # Si encontramos NIT o C.C sin números en la misma línea, buscar en líneas siguientes
                if re.search(r'\bNIT\b', line, re.IGNORECASE):
                    # Buscar números en las próximas 3 líneas
                    for offset in range(1, 4):
                        if i + offset < len(self.lines):
                            next_line = self.lines[i + offset].strip()
                            
                            # Buscar números al inicio de la línea o después de espacios
                            number_match = re.search(r'^(\d{8,12})', next_line)
                            if number_match:
                                nit = f"NIT {number_match.group(1)}"
                                self.result["propietario_identificacion"] = nit
                                return True
                
                # Similar para C.C
                if re.search(r'\bC\.?C\.?\b', line, re.IGNORECASE):
                    # Buscar números en las próximas 3 líneas
                    for offset in range(1, 4):
                        if i + offset < len(self.lines):
                            next_line = self.lines[i + offset].strip()
                            
                            # Buscar números al inicio de la línea
                            number_match = re.search(r'^(\d{7,11})', next_line)
                            if number_match:
                                cc = f"CC {number_match.group(1)}"
                                self.result["propietario_identificacion"] = cc
                                return True
        
        # Si no se encontró el propietario, hacer búsqueda general como fallback
        else:
            # Recorrer todas las líneas buscando NIT o C.C directamente
            for i, line in enumerate(self.lines):
                
                # Buscar NIT directamente
                nit_match = re.search(r'NIT\s+(\d+)', line, re.IGNORECASE)
                if nit_match:
                    nit = f"NIT {nit_match.group(1)}"
                    self.result["propietario_identificacion"] = nit
                    return True
                
                # Buscar C.C directamente
                cc_match = re.search(r'C\.?C\.?\s+(\d+)', line, re.IGNORECASE)
                if cc_match:
                    cc = f"CC {cc_match.group(1)}"
                    self.result["propietario_identificacion"] = cc
                    return True
                
                # Si encontramos NIT o C.C sin números en la misma línea, buscar en líneas siguientes
                if re.search(r'\bNIT\b', line, re.IGNORECASE):
                    # Buscar números en las próximas 3 líneas
                    for offset in range(1, 4):
                        if i + offset < len(self.lines):
                            next_line = self.lines[i + offset].strip()
                            
                            # Buscar números al inicio de la línea o después de espacios
                            number_match = re.search(r'^(\d{8,12})', next_line)
                            if number_match:
                                nit = f"NIT {number_match.group(1)}"
                                self.result["propietario_identificacion"] = nit
                                return True
                
                # Similar para C.C
                if re.search(r'\bC\.?C\.?\b', line, re.IGNORECASE):
                    # Buscar números en las próximas 3 líneas
                    for offset in range(1, 4):
                        if i + offset < len(self.lines):
                            next_line = self.lines[i + offset].strip()
                            
                            # Buscar números al inicio de la línea
                            number_match = re.search(r'^(\d{7,11})', next_line)
                            if number_match:
                                cc = f"CC {number_match.group(1)}"
                                self.result["propietario_identificacion"] = cc
                                return True
        
        return "propietario_nombre" in self.result

    def convert_fecha_format(self, fecha_str):
        """Convertir diferentes formatos de fecha a YYYY-MM-DD"""
        try:
            # Limpiar la fecha de espacios extra
            fecha_str = re.sub(r'\s+', ' ', fecha_str.strip())
            
            # Separadores posibles
            if '/' in fecha_str:
                separador = '/'
            elif '-' in fecha_str:
                separador = '-'
            elif '.' in fecha_str:
                separador = '.'
            elif ' ' in fecha_str:
                separador = ' '
            else:
                return None
            
            partes = fecha_str.split(separador)
            if len(partes) != 3:
                return None
            
            # Limpiar cada parte
            partes = [parte.strip() for parte in partes]
            
            # Determinar el formato basado en la longitud y valores
            # Si la primera parte tiene 4 dígitos, probablemente es YYYY-MM-DD
            if len(partes[0]) == 4 and partes[0].isdigit():
                year, month, day = partes[0], partes[1], partes[2]
            # Si la última parte tiene 4 dígitos, probablemente es DD-MM-YYYY
            elif len(partes[2]) == 4 and partes[2].isdigit():
                day, month, year = partes[0], partes[1], partes[2]
            else:
                return None
            
            # Validar los valores
            year_int = int(year)
            month_int = int(month)
            day_int = int(day)
            
            if not (1900 <= year_int <= 2030):
                return None
            if not (1 <= month_int <= 12):
                return None
            if not (1 <= day_int <= 31):
                return None
            
            # Formatear con ceros a la izquierda
            return f"{year_int}-{month_int:02d}-{day_int:02d}"
            
        except (ValueError, IndexError, AttributeError):
            return None

    
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
            
            # Buscar en la misma línea y las siguientes 10 líneas
            for i in range(fecha_idx, min(fecha_idx + 11, len(self.lines))):
                line = self.lines[i].strip()
                
                # Patrones de fecha más flexibles
                fecha_patterns = [
                    r'(\d{1,2}/\d{1,2}/\d{4})',        # DD/MM/YYYY o D/M/YYYY
                    r'(\d{1,2}-\d{1,2}-\d{4})',        # DD-MM-YYYY o D-M-YYYY
                    r'(\d{1,2}\.\d{1,2}\.\d{4})',      # DD.MM.YYYY o D.M.YYYY
                    r'(\d{4}/\d{1,2}/\d{1,2})',        # YYYY/MM/DD
                    r'(\d{4}-\d{1,2}-\d{1,2})',        # YYYY-MM-DD
                    r'(\d{1,2}\s+\d{1,2}\s+\d{4})',    # DD MM YYYY (con espacios)
                ]
                
                for pattern in fecha_patterns:
                    match = re.search(pattern, line)
                    if match:
                        fecha_str = match.group(1)
                        
                        # Procesar la fecha según el formato encontrado
                        fecha_convertida = self.convert_fecha_format(fecha_str)
                        if fecha_convertida:
                            self.result["fecha_matricula"] = fecha_convertida
                            return True
            
            # Si no encuentra con patrones exactos, buscar números que parezcan fechas
            for i in range(fecha_idx, min(fecha_idx + 11, len(self.lines))):
                line = self.lines[i].strip()
                
                # Buscar secuencias de números que podrían ser fechas
                numbers = re.findall(r'\d+', line)
                if len(numbers) >= 3:
                    # Intentar construir fecha con los primeros 3 números
                    try:
                        day, month, year = numbers[0], numbers[1], numbers[2]
                        if len(year) == 4 and 1900 <= int(year) <= 2030:
                            if 1 <= int(day) <= 31 and 1 <= int(month) <= 12:
                                fecha_convertida = f"{year}-{month.zfill(2)}-{day.zfill(2)}"
                                self.result["fecha_matricula"] = fecha_convertida
                                return True
                    except (ValueError, IndexError):
                        continue
        
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

if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser(description='Procesar datos OCR')
        parser.add_argument('--file', type=str, help='Ruta al archivo JSON con datos OCR')
        parser.add_argument('--placa', type=str, help='Placa del vehículo (opcional)')
        
        args = parser.parse_args()
        
        # Determinar qué archivo procesar
        file_path = None
        
        if args.file:
            # Usar el archivo especificado por argumento
            file_path = args.file
            if not os.path.exists(file_path):
                print(f"ERROR: El archivo {file_path} no existe", file=sys.stderr)
                print(json.dumps({"error": f"Archivo no encontrado: {file_path}"}))
                sys.exit(1)
        elif len(sys.argv) > 1 and not sys.argv[1].startswith('--'):
            # Si el primer argumento no es una opción, intentar interpretarlo como JSON
            try:
                data = json.loads(sys.argv[1])
                # Si llegamos aquí, el JSON se parseó correctamente, no necesitamos archivo
                file_path = None
            except json.JSONDecodeError:
                print("ERROR: El primer argumento no es JSON válido", file=sys.stderr)
                print(json.dumps({"error": "Argumento no es JSON válido"}))
                sys.exit(1)
        else:
            # Usar archivo por defecto
            file_path = './src/temp/tempOcrDataTARJETA_DE_PROPIEDAD.json'
            if not os.path.exists(file_path):
                print(f"ERROR: El archivo por defecto {file_path} no existe", file=sys.stderr)
                print(json.dumps({"error": f"Archivo por defecto no encontrado: {file_path}"}))
                sys.exit(1)
        
        # Leer datos si es necesario
        if file_path:
            try:
                with open(file_path, 'r', encoding='utf-8') as file:
                    data = json.load(file)
            except json.JSONDecodeError as e:
                print(f"ERROR: El archivo no contiene JSON válido: {str(e)}", file=sys.stderr)
                print(json.dumps({"error": f"JSON inválido en archivo: {str(e)}"}))
                sys.exit(1)
        
        # Procesar los datos
        result = process_ocr_data(data)
        
        # Imprimir resultado como JSON (único output a stdout)
        print(json.dumps(result, indent=4, ensure_ascii=False))
        
    except Exception as e:
        # Errores a stderr para depuración
        print(f"ERROR inesperado: {str(e)}", file=sys.stderr)
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        
        # Error en formato JSON a stdout para que el proceso JS pueda capturarlo
        print(json.dumps({"error": str(e)}))
        sys.exit(1)