# midwest-motion-mgmt

Run SAM2 object tracking on MR-Linac images.

## System requirements

The Docker image is built for Linux. A CUDA-compatible GPU is recommended, but not required.

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
3. We start object tracking from images `TwoDImages/00{285,286}_Frame_ID_XXX.mha`, and run until `TwoDImages/00{1531,1532}_Frame_ID_XXX.mha`
4. We compute similarity metrics by comparing predicted masks against the contours in `TwoDImages/TargetStructure/`

### Contours vs masks

Input registrations and targets can be contours or masks. SAM2 operates on masks, so if contours are provided, we fill them in before running analysis.
