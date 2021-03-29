include ../boilerplate.mk

layer/bin/ffmpeg:
> rm -rf layer
> mkdir -p {layer/bin,download}
> curl https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar xJ -C download
> mv download/ffmpeg*/ffmpeg layer/bin
> rm -r download
