FROM public.ecr.aws/lambda/nodejs:22

# Copy Lambda code and dependencies
COPY *.js package.json ${LAMBDA_TASK_ROOT}/
COPY node_modules ${LAMBDA_TASK_ROOT}/node_modules

# Set PATH for FFmpeg and FFprobe
ENV PATH=/var/task/bin:/var/lang/bin:/usr/local/bin:/usr/bin/:/bin:/opt/bin

# Specify the handler name
CMD [ "index.handler" ]
