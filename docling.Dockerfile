FROM python:3.12-slim

WORKDIR /opt/app-root/src

# Install uv for fast dependency resolution.
RUN pip install --no-cache-dir uv

# Pin to the same versions as the working venv on dev01.
# Use opencv-python-headless to avoid needing X11/gui libraries in the slim image.
RUN uv pip install --system --no-cache-dir \
    opencv-python-headless \
    docling==2.96.0 \
    docling-serve==1.20.0 \
    rapidocr==3.8.1

EXPOSE 5001

CMD ["docling-serve", "run", "--host", "0.0.0.0", "--port", "5001"]
