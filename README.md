# midwest-motion-mgmt

Multi-object tracking for MRgRT.

# Contouring web app
## Installation
This app requires uv (a Python package manager) and Node.js. Follow the instructions below to install:

1. Install uv: https://docs.astral.sh/uv/getting-started/installation/
2. Install Node.js: https://nodejs.org/en/download

Then, clone this repo onto your local computer. In your terminal:
```bash
git clone git@github.com:mzhu22/midwest-motion-mgmt.git
cd midwest-motion-mgmt
```

Then install package dependencies (make sure you're in the repo directory).
```bash
# Install backend deps
uv sync

# Install frontend deps
cd frontend && npm install && cd ..
```

## Starting the app
Run the following in your terminal, and the app should open in the browser.
```bash
uv run launch.py
```

# Object tracking Docker image
## Requirements
The Docker image is built for Linux.

A CUDA-compatible GPU is recommended, but not required. If using a GPU, the [Nvidia Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) must be installed to enable GPU acceleration for Docker containers.

## How to use

### Volume mounting

The Docker image expects input files at `/input` and writes outputs to `/output`. These should be provided as volume mounts.

Example usage:

```bash
docker run -it --rm \
    -v /PATH/TO/IMAGES:/input \
    -v /PATH/TO/OUTPUT:/output \
    ghcr.io/mzhu22/midwest-motion-mgmt:latest
```

### Model weights

SAM2 comes in four model sizes: `tiny`, `small`, `base_plus`, `large`, with tradeoffs in speed vs accuracy. We use `base_plus` by default. You can switch using the `--sam2_model_size` arg.

### More info

For more info, run the CLI app with `-h`.

```bash
docker run -it --rm ghcr.io/mzhu22/midwest-motion-mgmt:latest -h
```

## Output

```bash
sagittal/
    masks.mha       # (W, H, T) array of boolean masks, 2D images over time. True is the object, False is background
    analysis.json   # metadata and image similarity metrics
coronal/
    ...same as above
```

## Expected input

The directory mounted to `/input` should have the following structure:

```bash
TwoDImages/
    RegistrationStructure/
        ...registration contour .mha files
    TargetStructure/
        ...ground truth contour .mha files
    ...image .mha files
```

### Assumptions

- Images are 2D `.mha` files that begin with a 5-digit frame index `NNNNN_`, e.g., `01531_Frame_ID_1f44a857-3d35-4212-b005-f49928310a10_118.1916_(ms).mha`
- Odd-numbered images are sagittal, even-numbered are coronal, in order. E.g., frames 1, 3, 5, ... are consecutive frames from the sagittal scan.
- For all contours, 0 is positive, 255 is negative
- `RegistrationStructure/` should contain at least two MHA files with consecutive indices. We use the first file for each scan, by frame index, to begin the object tracking process.
- `TargetStructure/` contains one file for each image frame, starting from the first index in `RegistrationStructure`

E.g., for the following directory:

```bash
TwoDImages/
    RegistrationStructure/
        00285_Frame_ID_XXXXX.mha
        00286_Frame_ID_XXXXX.mha
        ...
    TargetStructure/
        00285_Frame_ID_XXXXX.mha
        00286_Frame_ID_XXXXX.mha
        ...
        01531_Frame_ID_XXXXX.mha
        01532_Frame_ID_XXXXX.mha
    00001_Frame_ID_XXXXX.mha
    00002_Frame_ID_XXXXX.mha
    ...
    01531_Frame_ID_XXXXX.mha
    01532_Frame_ID_XXXXX.mha
```

We:

1. Treat frames 1, 3, 5... as consecutive frames for the sagittal scan, and 2, 4, 6... for coronal
2. We use `TwoDImages/RegistrationStructure/{00285,00286}_Frame_ID_XXXXX.mha` as the starting contours for tracking
3. We start object tracking from images `TwoDImages/{00285,00286}_Frame_ID_XXX.mha`, and run until `TwoDImages/{01531,01532}_Frame_ID_XXX.mha`
4. We compute similarity metrics by comparing predicted masks against the contours in `TwoDImages/TargetStructure/`