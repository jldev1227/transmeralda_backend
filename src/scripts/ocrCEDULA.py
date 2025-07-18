import json
import re
from datetime import datetime
import unicodedata
import sys
import os
import argparse
import traceback

# Función para normalizar texto
def normalize_text(text):
    return unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('utf-8').upper()

class CEDULAProcessor:
    def __init__(self, ocr_data, numero_identificacion=None):
        self.data = ocr_data
        self.content = ocr_data.get('analyzeResult', {}).get('content', '')
        self.lines = self.content.split('\n')
        self.numero_identificacion = numero_identificacion
        self.result = {
            "nombre": None,
            "apellido": None,
        }
    
    def find_line_index(self, keyword, normalize=True):
        """Encontrar el índice de la línea que contiene una palabra clave"""
        keyword_norm = normalize_text(keyword) if normalize else keyword
        for i, line in enumerate(self.lines):
            line_norm = normalize_text(line) if normalize else line
            if keyword_norm in line_norm:
                return i
        return -1
    
    def is_valid_cedula(self):
        """Verificar si el documento es una cédula de ciudadanía válida"""
        # Buscar términos clave de la cédula en el contenido normalizado
        keywords = [
            "REPUBLICA DE COLOMBIA IDENTIFICACION PERSONAL CEDULA DE CIUDADANIA",
            "CEDULA DE CIUDADANIA",
            "IDENTIFICACION PERSONAL"
        ]
        normalized_content = normalize_text(self.content)
        for keyword in keywords:
            if keyword in normalized_content:
                return True
        return False
    
    # OPCIÓN 1: Método de instancia (recomendado)
    def normalize_numero_identificacion(self, numero):
        """Normalizar número de identificación quitando puntos y espacios"""
        if not numero:
            return ""
        return re.sub(r'[.\s]', '', str(numero))

    def extract_numero_identificacion(self):
        """Extraer la numero_identificacion del vehículo"""
        # Si tenemos una numero_identificacion proporcionada como parámetro, usarla para buscarla en el contenido
        if self.numero_identificacion:
            # Normalizar la numero_identificacion de búsqueda (quitar puntos y convertir a mayúsculas)
            numero_identificacion_normalizada = self.normalize_numero_identificacion(self.numero_identificacion).upper()
        
            # Buscar la numero_identificacion en todo el contenido
            for line in self.lines:
                normalized_line = normalize_text(line)
                # También normalizar la línea para quitar puntos
                normalized_line_sin_puntos = self.normalize_numero_identificacion(normalized_line)
                
                if numero_identificacion_normalizada in normalized_line_sin_puntos:
                    # Si encuentra la numero_identificacion en el contenido, la establece como resultado (normalizada)
                    self.result["numero_identificacion"] = numero_identificacion_normalizada
                    return True
                
            # Si llegamos aquí, la numero_identificacion no se encontró en el contenido
            return False
            
        # Si no hay numero_identificacion como parámetro, buscar usando regex
        
        # Primero buscar números con puntos después de "NÚMERO"
        numero_pattern = r'NÚMERO.*?(\d{1,3}(?:\.\d{3})*(?:\.\d{1,3})?)'
        
        # Buscar en todas las líneas
        for line in self.lines:
            # Buscar patrón de NÚMERO seguido del número con puntos
            match = re.search(numero_pattern, line, re.IGNORECASE)
            if match:
                # Normalizar el resultado quitando puntos
                numero_encontrado = self.normalize_numero_identificacion(match.group(1))
                self.result["numero_identificacion"] = numero_encontrado
                return True
        
        # También buscar el patrón en líneas consecutivas (NÚMERO en una línea, número en la siguiente)
        for i, line in enumerate(self.lines):
            if re.search(r'NÚMERO', line, re.IGNORECASE):
                # Buscar en las siguientes 3 líneas
                for j in range(i + 1, min(i + 4, len(self.lines))):
                    next_line = self.lines[j].strip()
                    # Buscar número con puntos al inicio de la línea o después de espacios
                    number_match = re.search(r'^\s*(\d{1,3}(?:\.\d{3})*(?:\.\d{1,3})?)', next_line)
                    if number_match:
                        # Normalizar el resultado quitando puntos
                        numero_encontrado = self.normalize_numero_identificacion(number_match.group(1))
                        self.result["numero_identificacion"] = numero_encontrado
                        return True
        
        # Fallback: buscar cualquier número con puntos en el formato esperado
        general_number_pattern = r'\b(\d{1,3}(?:\.\d{3})*(?:\.\d{1,3})?)\b'
        for line in self.lines:
            matches = re.findall(general_number_pattern, line)
            for match in matches:
                # Filtrar números que parezcan identificaciones (más de 6 dígitos)
                digits_only = self.normalize_numero_identificacion(match)
                if len(digits_only) >= 6:
                    # Guardar el número normalizado (sin puntos)
                    self.result["numero_identificacion"] = digits_only
                    return True
        
        # Mantener el comportamiento anterior con NÚMERO como fallback
        numero_identificacion_idx = self.find_line_index("NÚMERO")
        if numero_identificacion_idx >= 0:
            # Buscar en esta línea y las siguientes
            for i in range(numero_identificacion_idx, min(numero_identificacion_idx + 5, len(self.lines))):
                match = re.search(r'[A-Z]{3}\d{3}', self.lines[i])
                if match:
                    # Este patrón no tiene puntos, pero aplicar normalización por consistencia
                    numero_encontrado = self.normalize_numero_identificacion(match.group(0))
                    self.result["numero_identificacion"] = numero_encontrado
                    return True

        # Si no encuentra con "NÚMERO", buscar patrón de numero_identificacion en todas las líneas
        for line in self.lines:
            match = re.search(r'[A-Z]{3}\d{3}', line)
            if match:
                # Este patrón no tiene puntos, pero aplicar normalización por consistencia
                numero_encontrado = self.normalize_numero_identificacion(match.group(0))
                self.result["numero_identificacion"] = numero_encontrado
                return True

        return False
    
    def clean_apellidos_text(self, apellidos_text):
        """Limpiar el texto de apellidos removiendo números de identificación y palabras clave"""
        if not apellidos_text:
            return apellidos_text
        
        # Remover números de identificación (formato con puntos)
        numero_pattern = r'\b\d{1,3}(?:\.\d{3})*(?:\.\d{1,3})?\b'
        cleaned_text = re.sub(numero_pattern, '', apellidos_text)
        
        # Remover la palabra "NÚMERO" y variaciones
        cleaned_text = re.sub(r'\bNÚMERO\b', '', cleaned_text, flags=re.IGNORECASE)
        cleaned_text = re.sub(r'\bNUMERO\b', '', cleaned_text, flags=re.IGNORECASE)
        
        # Limpiar espacios múltiples y espacios al inicio/final
        cleaned_text = re.sub(r'\s+', ' ', cleaned_text).strip()
        
        return cleaned_text

    def extract_nombre_apellido(self):
        """Extraer nombre y apellido usando regex y patterns del contenido"""
        
        try:
            # Usar el contenido completo como texto
            content = self.content.upper().strip()
            
            # Pattern principal: buscar la estructura completa
            # NUMERO [número] [apellidos] APELLIDOS [nombres] NOMBRES
            main_pattern = r'NUMERO\s+[\d\.\-]+\s+([A-ZÁÉÍÓÚÑÜ\s]+?)\s+APELLIDOS\s+([A-ZÁÉÍÓÚÑÜ\s]+?)\s+NOMBRES'
            match = re.search(main_pattern, content)
            
            if match:
                apellidos_raw = match.group(1).strip()
                nombres_raw = match.group(2).strip()
                
                # Limpiar y validar apellidos
                apellidos_clean = self._clean_and_validate_name(apellidos_raw)
                nombres_clean = self._clean_and_validate_name(nombres_raw)
                
                if apellidos_clean:
                    self.result["apellido"] = normalize_text(apellidos_clean)
                
                if nombres_clean:
                    self.result["nombre"] = normalize_text(nombres_clean)
                
                return bool(apellidos_clean and nombres_clean)
            
            # Si no funciona el pattern principal, intentar patterns alternativos
            return self._extract_with_alternative_patterns()
            
        except Exception as e:
            print(f"Error extrayendo nombre y apellido: {e}")
            return False
    
    def _clean_and_validate_name(self, text):
        """Limpiar y validar que el texto sea un nombre/apellido válido"""
        
        if not text:
            return ""
        
        # Blacklist de palabras a descartar
        blacklist = {
            # Documentos y títulos
            "REPUBLICA", "COLOMBIA", "IDENTIFICACION", "PERSONAL", "CEDULA", "CIUDADANIA",
            "DOCUMENTO", "TARJETA", "CARNET", "LICENCIA", "REGISTRO",
            
            # Etiquetas del documento
            "NUMERO", "APELLIDOS", "NOMBRES", "FECHA", "NACIMIENTO", "LUGAR", "SEXO",
            "ESTATURA", "FIRMA", "EXPEDICION", "SANGRE", "TIPO", "GRUPO", "SANGUINEO",
            
            # Palabras técnicas
            "ACTIVATION", "DERECHO", "IZQUIERDO", "INDICE", "HUELLA", "DACTILAR",
            "REGISTRADOR", "NACIONAL", "CODIGO", "BARRAS",
            
            # Símbolos y caracteres especiales comunes en OCR
            "€", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", 
            "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
            
            # Conectores y artículos
            "DE", "DEL", "LA", "LAS", "EL", "LOS", "Y", "E",
            
            # Lugares comunes (pueden aparecer en direcciones)
            "BOGOTA", "MEDELLIN", "CALI", "BARRANQUILLA", "CARTAGENA", "YOPAL",
            "SOGAMOSO", "BOYACA", "CUNDINAMARCA", "ANTIOQUIA", "VALLE",
            
            # Términos médicos/técnicos
            "RH", "GS", "CM", "MTS", "METROS"
        }
        
        # Limpiar el texto
        text = text.strip()
        
        # Remover números y símbolos especiales
        text = re.sub(r'\d+', '', text)
        text = re.sub(r'[^\w\sÑñÁáÉéÍíÓóÚúÜü]', ' ', text)
        
        # Dividir en palabras
        words = text.split()
        valid_words = []
        
        for word in words:
            word = word.strip().upper()
            
            # Validaciones básicas
            if len(word) < 2:  # Muy corto
                continue
                
            if word in blacklist:  # En blacklist
                continue
                
            # Debe ser solo letras (incluyendo acentos y ñ)
            if not self._is_valid_name_word(word):
                continue
                
            # Debe tener al menos una vocal
            if not re.search(r'[AEIOUÁÉÍÓÚÜ]', word):
                continue
                
            # No debe ser solo consonantes repetidas
            if re.match(r'^([BCDFGHJKLMNPQRSTVWXYZ])\1+$', word):
                continue
                
            valid_words.append(word.title())  # Capitalizar apropiadamente
        
        result = " ".join(valid_words)
        return result
    
    def _is_valid_name_word(self, word):
        """Verificar si una palabra es válida para un nombre"""
        
        # Solo letras, incluyendo caracteres especiales del español
        spanish_letters = r'^[A-ZÁÉÍÓÚÜÑ]+$'
        if not re.match(spanish_letters, word):
            return False
            
        # No debe ser muy largo (nombres típicos < 15 caracteres)
        if len(word) > 15:
            return False
            
        # No debe tener solo consonantes o solo vocales
        consonants = len(re.findall(r'[BCDFGHJKLMNPQRSTVWXYZ]', word))
        vowels = len(re.findall(r'[AEIOUÁÉÍÓÚÜ]', word))
        
        if consonants == 0 or vowels == 0:
            return False
            
        # Ratio consonantes/vocales debe ser razonable
        if consonants > 0 and vowels > 0:
            ratio = consonants / vowels
            if ratio > 4 or ratio < 0.2:  # Muy pocas vocales o muy pocas consonantes
                return False
        
        return True
    
    def _extract_with_alternative_patterns(self):
        """Patterns alternativos si el principal no funciona"""
        
        content = self.content.upper()
        
        # Pattern 1: Buscar por líneas separadas
        lines = content.split('\n')
        apellidos_line = None
        nombres_line = None
        
        for i, line in enumerate(lines):
            if 'APELLIDOS' in line and apellidos_line is None:
                # Buscar apellidos en líneas anteriores
                for j in range(max(0, i-3), i):
                    potential = self._extract_names_from_line(lines[j])
                    if potential:
                        apellidos_line = potential
                        break
                        
                # Si no se encontró antes, buscar en la misma línea
                if not apellidos_line:
                    apellidos_line = self._extract_names_from_line(line.replace('APELLIDOS', ''))
            
            if 'NOMBRES' in line and nombres_line is None:
                # Buscar nombres en líneas anteriores
                for j in range(max(0, i-3), i):
                    potential = self._extract_names_from_line(lines[j])
                    if potential:
                        nombres_line = potential
                        break
                        
                # Si no se encontró antes, buscar en la misma línea
                if not nombres_line:
                    nombres_line = self._extract_names_from_line(line.replace('NOMBRES', ''))
        
        # Pattern 2: Buscar secuencias de palabras que parezcan nombres
        if not apellidos_line or not nombres_line:
            name_sequences = self._find_name_sequences(content)
            
            if not apellidos_line and len(name_sequences) > 0:
                apellidos_line = name_sequences[0]
            
            if not nombres_line and len(name_sequences) > 1:
                nombres_line = name_sequences[1]
        
        # Asignar resultados
        if apellidos_line:
            apellidos_clean = self._clean_and_validate_name(apellidos_line)
            if apellidos_clean:
                self.result["apellido"] = normalize_text(apellidos_clean)
        
        if nombres_line:
            nombres_clean = self._clean_and_validate_name(nombres_line)
            if nombres_clean:
                self.result["nombre"] = normalize_text(nombres_clean)
        
        return bool(apellidos_line and nombres_line)
    
    def _extract_names_from_line(self, line):
        """Extraer nombres de una línea específica"""
        
        # Remover números y elementos obviamente no nombres
        line = re.sub(r'\d+[\.\-\d]*', '', line)
        line = re.sub(r'[^\w\sÑñÁáÉéÍíÓóÚúÜü]', ' ', line)
        
        words = line.split()
        name_words = []
        
        for word in words:
            word = word.strip().upper()
            if (len(word) >= 2 and 
                self._is_valid_name_word(word) and 
                self._clean_and_validate_name(word)):
                name_words.append(word)
        
        return " ".join(name_words) if name_words else None
    
    def _find_name_sequences(self, content):
        """Encontrar secuencias de palabras que parezcan nombres"""
        
        # Buscar secuencias de 1-3 palabras consecutivas que parezcan nombres
        words = re.findall(r'\b[A-ZÁÉÍÓÚÜÑ]{2,}\b', content)
        
        sequences = []
        current_sequence = []
        
        for word in words:
            if self._is_valid_name_word(word) and self._clean_and_validate_name(word):
                current_sequence.append(word)
                
                # Si tenemos 2-3 palabras consecutivas, es una secuencia válida
                if len(current_sequence) >= 2:
                    sequences.append(" ".join(current_sequence))
                    current_sequence = []
            else:
                if len(current_sequence) >= 2:
                    sequences.append(" ".join(current_sequence))
                current_sequence = []
        
        # Agregar la última secuencia si es válida
        if len(current_sequence) >= 2:
            sequences.append(" ".join(current_sequence))
        
        return sequences

    def extract_date_borning(self):
        """Extraer la fecha de nacimiento de la CEDULA y formatearla en DD/MM/YYYY"""
        fecha_nacimiento_idx = self.find_line_index("FECHA DE NACIMIENTO")
        if fecha_nacimiento_idx >= 0:
            
            # Buscar en la línea actual Y en las líneas siguientes
            lines_to_check = []
            
            # Caso 1: Fecha en la misma línea
            fecha_line = self.lines[fecha_nacimiento_idx].strip()
            lines_to_check.append(("actual", fecha_line))
            
            # Caso 2: Fecha en las líneas siguientes (hasta 3 líneas después)
            for i in range(1, 4):
                if fecha_nacimiento_idx + i < len(self.lines):
                    next_line = self.lines[fecha_nacimiento_idx + i].strip()
                    if next_line:  # Solo líneas no vacías
                        lines_to_check.append((f"+{i}", next_line))
            
            # Buscar patrones de fecha en todas las líneas candidatas
            for line_type, line in lines_to_check:
                
                # Patrón 1: Formato DD/MM/YYYY
                match1 = re.search(r'(\d{1,2}/\d{1,2}/\d{4})', line)
                if match1:
                    try:
                        fecha_nacimiento = datetime.strptime(match1.group(1), '%d/%m/%Y')
                        fecha_formateada = fecha_nacimiento.strftime('%d/%m/%Y')
                        self.result["fecha_nacimiento"] = fecha_formateada
                        return True
                    except ValueError:
                        print(f"Error al parsear la fecha formato /: {match1.group(1)}")
                
                # Patrón 2: Formato DD-MMM-YYYY (ejemplo: 11-FEB-1995)
                match2 = re.search(r'(\d{1,2}-[A-Z]{3}-\d{4})', line)
                if match2:
                    try:
                        # Mapeo de meses en español/inglés
                        meses = {
                            'ENE': 'JAN', 'FEB': 'FEB', 'MAR': 'MAR', 'ABR': 'APR',
                            'MAY': 'MAY', 'JUN': 'JUN', 'JUL': 'JUL', 'AGO': 'AUG',
                            'SEP': 'SEP', 'OCT': 'OCT', 'NOV': 'NOV', 'DIC': 'DEC',
                            'JAN': 'JAN', 'AUG': 'AUG', 'DEC': 'DEC'  # En caso de que ya estén en inglés
                        }
                        
                        fecha_str = match2.group(1)
                        
                        # Reemplazar mes si es necesario
                        for esp, eng in meses.items():
                            fecha_str = fecha_str.replace(esp, eng)
                        
                        fecha_nacimiento = datetime.strptime(fecha_str, '%d-%b-%Y')
                        fecha_formateada = fecha_nacimiento.strftime('%d/%m/%Y')
                        self.result["fecha_nacimiento"] = fecha_formateada
                        return True
                    except ValueError:
                        print(f"Error al parsear la fecha formato -: {match2.group(1)}")
                
                # Patrón 3: Formato DD-MM-YYYY
                match3 = re.search(r'(\d{1,2}-\d{1,2}-\d{4})', line)
                if match3:
                    try:
                        fecha_nacimiento = datetime.strptime(match3.group(1), '%d-%m-%Y')
                        fecha_formateada = fecha_nacimiento.strftime('%d/%m/%Y')
                        self.result["fecha_nacimiento"] = fecha_formateada
                        return True
                    except ValueError:
                        print(f"Error al parsear la fecha formato - numérico: {match3.group(1)}")
                
                # Patrón 4: Formato YYYY/MM/DD o YYYY-MM-DD
                match4 = re.search(r'(\d{4}[/-]\d{1,2}[/-]\d{1,2})', line)
                if match4:
                    try:
                        fecha_str = match4.group(1)
                        separador = '/' if '/' in fecha_str else '-'
                        fecha_nacimiento = datetime.strptime(fecha_str, f'%Y{separador}%m{separador}%d')
                        fecha_formateada = fecha_nacimiento.strftime('%d/%m/%Y')
                        self.result["fecha_nacimiento"] = fecha_formateada
                        return True
                    except ValueError:
                        print(f"Error al parsear la fecha formato YYYY: {match4.group(1)}")
                
                # Patrón 5: Formato DD DE MMMM DE YYYY (español completo)
                match5 = re.search(r'(\d{1,2})\s+DE\s+([A-ZÁÉÍÓÚ]+)\s+DE\s+(\d{4})', line, re.IGNORECASE)
                if match5:
                    try:
                        day, month_name, year = match5.groups()
                        
                        meses_espanol = {
                            'ENERO': '01', 'FEBRERO': '02', 'MARZO': '03', 'ABRIL': '04',
                            'MAYO': '05', 'JUNIO': '06', 'JULIO': '07', 'AGOSTO': '08',
                            'SEPTIEMBRE': '09', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12'
                        }
                        
                        month_name_upper = month_name.upper()
                        if month_name_upper in meses_espanol:
                            month_num = meses_espanol[month_name_upper]
                            fecha_formateada = f"{day.zfill(2)}/{month_num}/{year}"
                            
                            # Validar la fecha creada
                            datetime.strptime(fecha_formateada, '%d/%m/%Y')
                            self.result["fecha_nacimiento"] = fecha_formateada
                            return True
                    except (ValueError, KeyError):
                        print(f"Error al parsear la fecha formato español: {match5.group(0)}")
                
                # Patrón 6: Formato DD MMMM YYYY (sin "DE")
                match6 = re.search(r'(\d{1,2})\s+([A-ZÁÉÍÓÚ]+)\s+(\d{4})', line, re.IGNORECASE)
                if match6:
                    try:
                        day, month_name, year = match6.groups()
                        
                        meses_espanol = {
                            'ENERO': '01', 'FEBRERO': '02', 'MARZO': '03', 'ABRIL': '04',
                            'MAYO': '05', 'JUNIO': '06', 'JULIO': '07', 'AGOSTO': '08',
                            'SEPTIEMBRE': '09', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12'
                        }
                        
                        month_name_upper = month_name.upper()
                        if month_name_upper in meses_espanol:
                            month_num = meses_espanol[month_name_upper]
                            fecha_formateada = f"{day.zfill(2)}/{month_num}/{year}"
                            
                            # Validar la fecha creada
                            datetime.strptime(fecha_formateada, '%d/%m/%Y')
                            self.result["fecha_nacimiento"] = fecha_formateada
                            return True
                    except (ValueError, KeyError):
                        print(f"Error al parsear la fecha formato español sin DE: {match6.group(0)}")
                
            
            print("No se encontró fecha de nacimiento en ninguna línea")
            return False
        else:
            print("No se encontró la etiqueta 'FECHA DE NACIMIENTO'")
            return False
        
    def extract_gender(self):
        """Extraer el género buscando directamente M o F en todo el contenido"""
        
        # Método 1: Buscar en todas las líneas
        for i, line in enumerate(self.lines):
            line_original = line.strip()
            
            # Caso 1: La línea es exactamente "M" o "F"
            if line_original == "M":
                self.result["genero"] = "M"
                return True
            elif line_original == "F":
                self.result["genero"] = "F"
                return True
            
            # Caso 2: Buscar M o F como tokens aislados en la línea
            # Limpiar la línea de palabras/términos conocidos que no son género
            line_clean = line_original
            
            # Blacklist de palabras que pueden contener M o F pero no son género
            blacklist_gender = [
                "REPUBLICA", "COLOMBIA", "IDENTIFICACION", "PERSONAL", "CEDULA", "CIUDADANIA",
                "NUMERO", "APELLIDOS", "NOMBRES", "FECHA", "NACIMIENTO", "LUGAR", "FIRMA",
                "ESTATURA", "SANGRE", "GRUPO", "SANGUINEO", "EXPEDICION", "DERECHO",
                "REGISTRADOR", "NACIONAL", "CARLOS", "ARIEL", "SANCHEZ", "TORRES",
                "ACTIVATION", "SOGAMOSO", "BOYACA", "YOPAL", "INDICE", "HUELLA"
            ]
            
            # Solo procesar si la línea no contiene palabras de la blacklist
            contains_blacklist = any(word in line_clean.upper() for word in blacklist_gender)
            
            if not contains_blacklist:
                # Remover números, puntos, guiones y otros símbolos
                line_clean = re.sub(r'[\d\.\-\+]+', '', line_clean)
                line_clean = re.sub(r'[^\w\s]', ' ', line_clean)
                line_clean = re.sub(r'\s+', ' ', line_clean).strip()
                
                # Dividir en tokens
                tokens = line_clean.split()
                m_found = False
                f_found = False
                
                for token in tokens:
                    token = token.strip().upper()
                    if token == "M":
                        m_found = True
                    elif token == "F":
                        f_found = True
                
                # Asignar género si solo se encontró uno
                if m_found and not f_found:
                    self.result["genero"] = "M"
                    return True
                elif f_found and not m_found:
                    self.result["genero"] = "F"
                    return True
                elif m_found and f_found:
                    # Si ambos están presentes, tomar el primero en la línea original
                    m_pos = line_original.upper().find("M")
                    f_pos = line_original.upper().find("F")
                    if m_pos >= 0 and (f_pos < 0 or m_pos < f_pos):
                        self.result["genero"] = "M"
                        return True
                    elif f_pos >= 0:
                        self.result["genero"] = "F"
                        return True
        
        # Método 2: Buscar usando OCR structure si el método de líneas falla
        return self._extract_gender_from_ocr()
    
    def _extract_gender_from_ocr(self):
        """Buscar género directamente en la estructura OCR"""
        
        try:
            analyze_result = self.data.get('analyzeResult', {})
            pages = analyze_result.get('pages', [])
            
            if not pages:
                return False
                
            words = pages[0].get('words', [])
            if not words:
                return False
            
            # Buscar palabras que sean exactamente M o F
            gender_candidates = []
            
            for i, word in enumerate(words):
                content = word.get("content", "").strip().upper()
                confidence = word.get("confidence", 0)
                
                # Solo considerar M o F con buena confianza
                if content in ["M", "F"] and confidence > 0.5:
                    gender_candidates.append({
                        'gender': content,
                        'confidence': confidence,
                        'index': i,
                        'word': word
                    })
            
            # Si encontramos candidatos, tomar el de mayor confianza
            if gender_candidates:
                # Ordenar por confianza descendente
                gender_candidates.sort(key=lambda x: x['confidence'], reverse=True)
                best_candidate = gender_candidates[0]
                
                self.result["genero"] = best_candidate['gender']
                return True
            
            return False
            
        except Exception as e:
            print(f"Error en búsqueda OCR de género: {e}")
            return False
    
    def _extract_gender_regex_fallback(self):
        """Método de fallback usando regex en todo el contenido"""
        
        content = self.content.upper()
        
        # Buscar M o F como palabras aisladas en todo el contenido
        # Excluir contextos donde M o F no representan género
        exclude_patterns = [
            r'REPUBLICA.*?M',
            r'COLOMBIA.*?M', 
            r'FIRMA.*?M',
            r'FORMATO.*?F',
            r'FEB.*?F',
            r'\d+.*?[MF]',  # Números seguidos de M o F
            r'[MF].*?\d+',  # M o F seguidos de números
        ]
        
        # Buscar M o F aisladas
        m_matches = re.finditer(r'\bM\b', content)
        f_matches = re.finditer(r'\bF\b', content)
        
        valid_m = []
        valid_f = []
        
        # Verificar que no estén en contextos excluidos
        for match in m_matches:
            start, end = match.span()
            context = content[max(0, start-20):min(len(content), end+20)]
            
            is_valid = True
            for pattern in exclude_patterns:
                if re.search(pattern, context):
                    is_valid = False
                    break
            
            if is_valid:
                valid_m.append(match)
        
        for match in f_matches:
            start, end = match.span()
            context = content[max(0, start-20):min(len(content), end+20)]
            
            is_valid = True
            for pattern in exclude_patterns:
                if re.search(pattern, context):
                    is_valid = False
                    break
            
            if is_valid:
                valid_f.append(match)
        
        # Asignar género basado en los matches válidos
        if valid_m and not valid_f:
            self.result["genero"] = "M"
            return True
        elif valid_f and not valid_m:
            self.result["genero"] = "F"
            return True
        elif valid_m and valid_f:
            # Si ambos, tomar el primero en el documento
            first_m = min(valid_m, key=lambda x: x.start()) if valid_m else None
            first_f = min(valid_f, key=lambda x: x.start()) if valid_f else None
            
            if first_m and (not first_f or first_m.start() < first_f.start()):
                self.result["genero"] = "M"
                return True
            elif first_f:
                self.result["genero"] = "F"
                return True
        
        return False

    def _is_isolated_gender_char(self, line, char):
        """Verificar si M o F aparece como carácter aislado en la línea"""
        
        # Casos donde consideramos que está aislado:
        # 1. La línea es exactamente el carácter
        if line.strip() == char:
            return True
        
        # 2. El carácter está rodeado de espacios
        if f" {char} " in line:
            return True
            
        # 3. El carácter está al inicio seguido de espacio
        if line.startswith(f"{char} "):
            return True
            
        # 4. El carácter está al final precedido de espacio
        if line.endswith(f" {char}"):
            return True
        
        # 5. Usar regex para buscar el carácter como palabra completa
        pattern = rf'\b{char}\b'
        if re.search(pattern, line):
            return True
        
        return False

    def extract_blood_type(self):
        """Extraer el tipo de sangre RH del documento"""
        
        # Grupos sanguíneos válidos
        blood_types = [
            "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-",
            "A +", "A -", "B +", "B -", "AB +", "AB -", "O +", "O -"
        ]
        
        rh_idx = self.find_line_index("RH")
        
        if rh_idx >= 0:
            # Buscar en las líneas anteriores al índice RH (revisar hasta 5 líneas anteriores)
            search_range = min(5, rh_idx)  # Buscar hasta 5 líneas anteriores o hasta el inicio
            
            for i in range(search_range):
                line_idx = rh_idx - 1 - i  # Empezar desde la línea anterior a RH
                if line_idx >= 0:
                    line = self.lines[line_idx].strip().upper()
                    
                    # Primero buscar coincidencias exactas con grupos sanguíneos válidos
                    for blood_type in blood_types:
                        blood_type_upper = blood_type.upper().replace(" ", "")  # Normalizar
                        line_normalized = line.replace(" ", "")
                        
                        if blood_type_upper in line_normalized:
                            self.result["tipo_sangre"] = blood_type_upper
                            return True
                    
                    # Si no se encuentra coincidencia exacta, buscar patrones con "0" que debe ser "O"
                    if "+" in line or "-" in line:
                        # Buscar patrón: número/letra seguido de + o -
                        pattern = r'([0ABOM])\s*([+-])'
                        matches = re.findall(pattern, line)
                        
                        for match in matches:
                            blood_letter, rh_sign = match
                            
                            # Convertir "0" a "O"
                            if blood_letter == "0":
                                blood_letter = "O"
                            
                            # Validar que sea un grupo sanguíneo válido
                            blood_type_candidate = f"{blood_letter}{rh_sign}"
                            valid_types = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
                            
                            if blood_type_candidate in valid_types:
                                self.result["tipo_sangre"] = blood_type_candidate
                                return True
                    
                    # Buscar patrones adicionales como "0+" o "0-" directamente
                    if re.search(r'0\s*[+-]', line):
                        converted_line = re.sub(r'0(\s*[+-])', r'O\1', line)
                        # Buscar nuevamente en la línea convertida
                        for blood_type in blood_types:
                            blood_type_upper = blood_type.upper().replace(" ", "")
                            if blood_type_upper in converted_line.replace(" ", ""):
                                self.result["tipo_sangre"] = blood_type_upper
                                return True
        
        print("No se pudo extraer el tipo de sangre")
        return False

    def process(self):
        """Procesar todos los campos y devolver el resultado"""
        if not self.is_valid_cedula():
            return {"error": "No es una CEDULA válida"}
        
        self.extract_numero_identificacion()
        self.extract_nombre_apellido()
        self.extract_date_borning()
        self.extract_gender()
        self.extract_blood_type()
        
        return self.result

# Función principal para procesar el OCR
def process_cedula_data(data, numero_identificacion=None):
    try:
        processor = CEDULAProcessor(data, numero_identificacion)
        result = processor.process()
        return result
    except Exception as e:
        import traceback
        return {"error": str(e), "trace": traceback.format_exc()}

# Ejecución principal
if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser(description='Procesar datos OCR')
        parser.add_argument('--file', type=str, help='Ruta al archivo JSON con datos OCR')
        parser.add_argument('--numero_identificacion', type=str, help='Identificación del conductor (opcional)')
        
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
            file_path = 'temp/tempOcrData_CEDULA.json'
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
        result = process_cedula_data(data, args.numero_identificacion)
        
        # Imprimir resultado como JSON (único output a stdout)
        print(json.dumps(result, indent=4, ensure_ascii=False))
        
    except Exception as e:
        # Errores a stderr para depuración
        print(f"ERROR inesperado: {str(e)}", file=sys.stderr)
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        
        # Error en formato JSON a stdout para que el proceso JS pueda capturarlo
        print(json.dumps({"error": str(e)}))
        sys.exit(1)