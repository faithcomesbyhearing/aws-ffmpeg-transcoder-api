include ../boilerplate.mk

layer/bin/ffprobe:
> rm -rf layer
> mkdir -p {layer/bin,download}
> curl https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar xJ -C download
> mv download/ffmpeg*/ffprobe layer/bin
> rm -r download
