-- One logical database per service. Runs once, when the (tmpfs) data directory is empty.
CREATE DATABASE core;
CREATE DATABASE extranet;
CREATE DATABASE agents;
CREATE DATABASE langfuse;
