import xml.etree.ElementTree as ET


class XMLParser:

    def parse(self, file_path: str, *, metadata: dict | None = None):

        metadata = dict(metadata or {})

        tree = ET.parse(file_path)

        root = tree.getroot()

        data = self._parse_element(root)

        return {

            "type": "xml",

            "schema_version": metadata.get("schema_version", "parser-v2"),

            "source": metadata.get("source") or file_path,

            "stage": metadata.get("stage"),

            "section": metadata.get("section"),

            "root": root.tag,

            "data": data
        }

    def _parse_element(self, element):

        result = {

            "tag": element.tag,

            "attributes": dict(
                element.attrib
            ),

            "text": (
                element.text.strip()
                if element.text
                else ""
            ),

            "children": []
        }

        for child in element:

            result["children"].append(
                self._parse_element(child)
            )

        return result
