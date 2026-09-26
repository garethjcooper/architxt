FROM python:3.12-slim

WORKDIR /opt/app-root/src

# Pin to the same versions as the working venv on dev01.
# docling-serve 1.20.0 pulls docling 2.96.0 as a dependency.
RUN pip install --no-cache-dir docling-serve==1.20.0

EXPOSE 5001

CMD ["docling-serve", "run", "--host", "0.0.0.0", "--port", "5001"]
