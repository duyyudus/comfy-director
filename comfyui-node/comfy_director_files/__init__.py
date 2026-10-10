"""Comfy Director companion node.

Lets the Comfy Director app list, preview and delete files in ComfyUI's input,
output and temp folders. It adds no nodes to the graph, only routes on ComfyUI's server.

Install: copy this folder (comfy_director_files) into ComfyUI/custom_nodes/ and
restart ComfyUI.

Routes (ComfyUI also serves them under /api):
  GET  /comfy_director/files?type=input|output|temp
       -> {"version": 1, "files": [{"filename", "subfolder", "size", "modified"}]}
  GET  /comfy_director/thumb?type=&subfolder=&filename=&size=160
       -> a small JPEG of an image, or of the first frame of a video (404 if neither)
  POST /comfy_director/files/delete   {"files": [{"filename", "subfolder", "type"}]}
       -> {"deleted": [...], "errors": [{"filename", "subfolder", "type", "message"}]}

Deleting from output or temp also clears ComfyUI's cache of node results, so a
job identical to an earlier one renders its file again. Loaded models stay loaded.

Nothing outside those three folders can be listed or deleted. The routes are as
protected as the rest of the server: keep it behind your reverse proxy token.
"""
import asyncio
import io
import os
from collections import OrderedDict

from aiohttp import web

import folder_paths
from server import PromptServer

VERSION = 2

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"}
# Thumbnails already made, newest last: (path, modified, bytes, size) -> JPEG data.
_thumbs = OrderedDict()
THUMBS_KEPT = 2000

# ComfyUI reports a custom node without these as a failed import.
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

_ROOTS = {
    "input": folder_paths.get_input_directory,
    "output": folder_paths.get_output_directory,
    "temp": folder_paths.get_temp_directory,
}

routes = PromptServer.instance.routes


def _root(kind):
    get = _ROOTS.get(kind)
    return os.path.realpath(get()) if get else None


def _list(root):
    files = []
    for folder, _dirs, names in os.walk(root):
        sub = os.path.relpath(folder, root).replace(os.sep, "/")
        sub = "" if sub == "." else sub
        for name in names:
            try:
                st = os.stat(os.path.join(folder, name))
            except OSError:
                continue
            files.append({"filename": name, "subfolder": sub, "size": st.st_size, "modified": st.st_mtime})
    return files


def _resolve(kind, subfolder, filename):
    """Path of a file inside one of the three folders, or None if it would be outside."""
    root = _root(kind)
    if not root or not filename or filename in (".", "..") or os.path.basename(filename) != filename:
        return None
    folder = os.path.realpath(os.path.join(root, subfolder or ""))
    try:
        if os.path.commonpath([root, folder]) != root:
            return None
    except ValueError:  # different drives on Windows
        return None
    return os.path.join(folder, filename)


def _delete(items):
    deleted, errors = [], []
    for item in items:
        item = item if isinstance(item, dict) else {}
        ref = {
            "filename": str(item.get("filename") or ""),
            "subfolder": str(item.get("subfolder") or ""),
            "type": str(item.get("type") or ""),
        }
        path = _resolve(ref["type"], ref["subfolder"], ref["filename"])
        if not path or os.path.isdir(path):
            errors.append({**ref, "message": "Not a file in the input, output or temp folder."})
            continue
        try:
            os.remove(path)
            deleted.append(ref)
        except FileNotFoundError:
            deleted.append(ref)  # already gone
        except OSError as e:
            errors.append({**ref, "message": e.strerror or str(e)})
    return {"deleted": deleted, "errors": errors}


def _thumb(path, size):
    """JPEG data of a picture at most `size` pixels on its long side, or None if the file is not one."""
    st = os.stat(path)
    key = (path, st.st_mtime, st.st_size, size)
    data = _thumbs.get(key)
    if data is not None:
        _thumbs.move_to_end(key)
        return data
    from PIL import Image, ImageOps

    ext = os.path.splitext(path)[1].lower()
    if ext in IMAGE_EXT:
        with Image.open(path) as opened:
            opened.draft("RGB", (size, size))  # lets a large JPEG decode at reduced size
            image = ImageOps.exif_transpose(opened).convert("RGB")
    elif ext in VIDEO_EXT:
        import av  # PyAV, which ComfyUI itself needs for video

        with av.open(path) as container:
            frame = next(container.decode(video=0), None)
        if frame is None:
            return None
        image = frame.to_image().convert("RGB")
    else:
        return None
    image.thumbnail((size, size))
    out = io.BytesIO()
    image.save(out, "JPEG", quality=80)
    data = out.getvalue()
    _thumbs[key] = data
    while len(_thumbs) > THUMBS_KEPT:
        _thumbs.popitem(last=False)
    return data


def _reset_cache():
    """Makes ComfyUI forget its cached node results (loaded models are kept).

    An identical job is otherwise answered from the cache, naming a file that was just
    deleted. The queue worker applies the flags when the running job, if any, ends.
    """
    try:
        queue = PromptServer.instance.prompt_queue
        queue.set_flag("unload_models", False)
        queue.set_flag("free_memory", True)
    except Exception:
        pass


@routes.get("/comfy_director/files")
async def list_files(request):
    root = _root(request.query.get("type", ""))
    if not root:
        return web.json_response({"error": "type must be input, output or temp."}, status=400)
    files = await asyncio.get_running_loop().run_in_executor(None, _list, root)
    return web.json_response({"version": VERSION, "files": files})


@routes.get("/comfy_director/thumb")
async def thumb(request):
    q = request.query
    path = _resolve(q.get("type", ""), q.get("subfolder", ""), q.get("filename", ""))
    if not path or not os.path.isfile(path):
        return web.Response(status=404)
    try:
        size = max(32, min(512, int(q.get("size", "160"))))
    except ValueError:
        size = 160
    try:
        data = await asyncio.get_running_loop().run_in_executor(None, _thumb, path, size)
    except Exception:
        data = None  # unreadable file, or no decoder for it
    if data is None:
        return web.Response(status=404)
    return web.Response(body=data, content_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@routes.post("/comfy_director/files/delete")
async def delete_files(request):
    try:
        body = await request.json()
    except Exception:
        body = None
    items = body.get("files") if isinstance(body, dict) else None
    if not isinstance(items, list):
        return web.json_response({"error": 'Expected {"files": [...]}.'}, status=400)
    result = await asyncio.get_running_loop().run_in_executor(None, _delete, items)
    if any(f["type"] != "input" for f in result["deleted"]):
        _reset_cache()
    return web.json_response(result)
