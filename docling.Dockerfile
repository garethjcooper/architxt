FROM python:3.12-slim

WORKDIR /opt/app-root/src

# Install docling and docling-serve with CPU-only PyTorch for correct image extraction.
RUN pip install --no-cache-dir \
    docling \
    docling-serve \
    --extra-index-url https://download.pytorch.org/whl/cpu

EXPOSE 5001

CMD ["python", "-m", "docling_serve", "run"]
