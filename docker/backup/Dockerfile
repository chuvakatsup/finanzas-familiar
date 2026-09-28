FROM alpine:3.24.2
# pg_dump/pg_restore de la misma versión mayor que la BD, age para cifrar, rclone para copia externa.
RUN apk add --no-cache postgresql17-client age rclone tzdata curl
COPY --chmod=0755 backup.sh restore.sh loop.sh /usr/local/bin/
ENTRYPOINT []
CMD ["/usr/local/bin/loop.sh"]
