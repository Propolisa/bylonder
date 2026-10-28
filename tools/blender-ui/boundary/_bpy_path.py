# Blender's _bpy_path (C, bpy_path.cc): the file extensions Blender 5.2.3 reads (_bpy_path in the reference binary).
extensions_audio = set(['.aac', '.ac3', '.aif', '.aiff', '.eac3', '.flac', '.m4a', '.mka', '.mp2', '.mp3', '.oga', '.ogg', '.opus', '.wav', '.wma'])
extensions_image = set(['.avif', '.bmp', '.cin', '.dds', '.dpx', '.exr', '.hdr', '.j2c', '.jp2', '.jpeg', '.jpg', '.pdd', '.png', '.psb', '.psd', '.rgb', '.rgba', '.sgi', '.tga', '.tif', '.tiff', '.tx', '.webp'])
extensions_movie = set(['.avi', '.avs', '.divx', '.dv', '.flc', '.flv', '.gif', '.m2t', '.m2ts', '.m2v', '.m4v', '.mkv', '.mov', '.movie', '.mp4', '.mpeg', '.mpg', '.mpg2', '.mts', '.mv', '.mxf', '.ogg', '.ogv', '.r3d', '.ts', '.vob', '.webm', '.wmv', '.xvid'])


def is_autoexec(filepath):
    return False
